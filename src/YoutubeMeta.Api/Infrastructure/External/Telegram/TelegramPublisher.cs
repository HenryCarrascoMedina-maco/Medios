using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Domain.Rules;

namespace YoutubeMeta.Api.Infrastructure.External.Telegram;

/// <summary>
/// Publica en un canal: texto o enlace (sendMessage), una foto (sendPhoto), un álbum (sendMediaGroup), un PDF
/// (sendDocument) o un video (sendVideo). Telegram publica en el acto (no hay procesamiento que consultar) y no
/// permite reanudar: un corte vuelve a enviar el archivo completo.
/// <para>
/// Telegram solo publica cuando recibe el archivo entero. Por eso el paso irreversible empieza al enviar el último
/// byte: un corte antes es un reintento normal; un corte después es un resultado dudoso. Un bot no puede leer el
/// historial del canal, así que ese caso lo revisa una persona.
/// </para>
/// </summary>
public sealed class TelegramPublisher(PublisherServices services, TelegramBotClient telegram, TelegramBots bots)
    : PlatformPublisherBase(services)
{
    public override string Platform => Platforms.Telegram;

    public override async Task<PublishStep> UploadAsync(PublicationDueItem item, string filePath, string leaseOwner, UploadHeartbeat heartbeat)
    {
        var bot = await bots.GetAsync(item.CredentialId, heartbeat.Token);
        if (bot is null)
            return PublishStep.NeedsReconnect("NO_BOT", "El bot de este canal ya no existe en Ajustes. Vuelve a conectar el canal con un bot.");

        if (PublicationRules.ValidateMedia(Platforms.Telegram, item.Media.Sum(m => m.SizeBytes), item.DurationSec, bot.Options.TelegramMaxUploadMb) is { } tooBig)
            return PublishStep.Failed("FILE_TOO_BIG", tooBig);

        var options = item.Options;
        if (item.PostKind != PostKinds.Video) return await SendPostAsync(item, bot, heartbeat);

        var sent = await telegram.SendVideoAsync(bot.Options.TelegramBaseUrl, bot.Token, new TelegramVideo(
            item.AccountExternalId,
            filePath,
            Path.GetFileName(filePath),
            item.ContentType ?? "video/mp4",
            PublicationRules.TelegramCaption(item.Title, item.Description),
            item.Width,
            item.Height,
            item.DurationSec,
            options.DisableNotification == true,
            options.ProtectContent == true), bytes =>
            {
                heartbeat.Report(bytes, item.SizeBytes);
                if (bytes >= item.SizeBytes) _ = heartbeat.MarkCommittingAsync();
            }, heartbeat.Token);

        return Outcome(item, sent, heartbeat);
    }

    /// <summary>
    /// Texto, enlace, fotos o PDF: un único envío. Como en el video, desde que se envía ya no se sabe si llegó: un
    /// corte a partir de ahí lo revisa una persona.
    /// </summary>
    private async Task<PublishStep> SendPostAsync(PublicationDueItem item, TelegramBot bot, UploadHeartbeat heartbeat)
    {
        var options = item.Options;
        string text = PublicationRules.TelegramCaption(item.Title, item.Description);
        long total = Math.Max(item.Media.Sum(m => m.SizeBytes), 1);

        await heartbeat.MarkCommittingAsync();
        TelegramResult<TelegramMessage> sent;
        if (item.Media.Count == 0)
        {
            if (item.PostKind == PostKinds.Link && item.LinkUrl is { } link && !text.Contains(link, StringComparison.OrdinalIgnoreCase))
                text = $"{text}\n\n{link}";
            sent = await telegram.SendMessageAsync(bot.Options.TelegramBaseUrl, bot.Token, item.AccountExternalId, text,
                options.DisableNotification == true, options.ProtectContent == true, heartbeat.Token);
        }
        else
        {
            var files = item.Media.Select(m => new TelegramFile(m.FullPath, Path.GetFileName(m.FullPath), m.ContentType)).ToList();
            sent = await telegram.SendFilesAsync(bot.Options.TelegramBaseUrl, bot.Token,
                new TelegramFiles(item.AccountExternalId, files, text, item.PostKind == PostKinds.Document, options.DisableNotification == true, options.ProtectContent == true),
                bytes => heartbeat.Report(bytes, total), heartbeat.Token);
        }

        return Outcome(item, sent, heartbeat);
    }

    private static PublishStep Outcome(PublicationDueItem item, TelegramResult<TelegramMessage> sent, UploadHeartbeat heartbeat)
    {
        if (sent.Ok) return PublishStep.Done(TelegramBotClient.MessageLink(item.AccountExternalId, sent.Data!.ChatUsername, sent.Data.MessageId));
        if (heartbeat.LeaseLost) return PublishStep.LeaseLost();
        return Classify(sent.Error!);
    }

    /// <summary>Nunca se llega aquí (sendVideo publica en el acto); por si una fila quedó en PROCESSING.</summary>
    public override Task<PublishStep> PollAsync(PublicationPollItem item, CancellationToken cancellationToken) =>
        Task.FromResult(PublishStep.Done(item.ExternalUrl));

    public override async Task<ConnectionTest> TestAsync(ConnectionRow connection, CancellationToken cancellationToken)
    {
        var bot = await bots.GetAsync(connection.CredentialId, cancellationToken);
        if (bot is null) return new(false, "El bot de este canal ya no existe en Ajustes.");

        var me = await telegram.GetMeAsync(bot.Options.TelegramBaseUrl, bot.Token, cancellationToken);
        if (!me.Ok) return new(false, Friendly(me.Error!));

        var member = await telegram.GetChatMemberAsync(bot.Options.TelegramBaseUrl, bot.Token, connection.ExternalId, me.Data!.Id, cancellationToken);
        if (!member.Ok) return new(false, Friendly(member.Error!));
        return member.Data!.CanPost
            ? new(true, $"Conexión correcta: @{me.Data.Username} puede publicar en «{connection.DisplayName}».")
            : new(false, $"@{me.Data.Username} ya no es administrador con permiso de publicar en el canal.");
    }

    public static string Friendly(TelegramError error) => error.Code switch
    {
        401 => "Telegram no reconoce el token del bot. Revísalo en Ajustes (quizá se regeneró en @BotFather).",
        403 => "El bot no está en el canal o lo expulsaron. Añádelo como administrador.",
        400 when error.Description.Contains("chat not found", StringComparison.OrdinalIgnoreCase) => "Telegram no encuentra el canal. Revisa el @usuario o añade el bot al canal.",
        _ => $"Telegram respondió: {error.Description}"
    };

    /// <summary>Error de Telegram → paso del job (lo comparten publicar y responder en la bandeja).</summary>
    public static PublishStep Classify(TelegramError error)
    {
        string tag = $"telegram:{error.Code}";
        if (error.Code == 429)
        {
            int seconds = Math.Clamp(error.RetryAfterSeconds ?? 60, 5, 3600);
            return PublishStep.WaitQuota(tag, $"Telegram pidió esperar {seconds} s antes de enviar más. Se reintenta solo.", TimeClock.UtcNow.AddSeconds(seconds));
        }
        if (error.Code is 401 or 403 || error.Description.Contains("not enough rights", StringComparison.OrdinalIgnoreCase)
            || error.Description.Contains("chat not found", StringComparison.OrdinalIgnoreCase))
            return PublishStep.NeedsReconnect(tag, Friendly(error));
        if (error.Code == 413 || error.Description.Contains("too big", StringComparison.OrdinalIgnoreCase))
            return PublishStep.Failed(tag, "El archivo supera el tamaño que admite el servidor Bot API del bot. Usa un servidor Bot API propio (hasta 2 GB) o un archivo más pequeño.");
        if (error.Code >= 500)
            return PublishStep.Retry(tag, $"Error temporal de Telegram: {error.Description}");
        return PublishStep.Failed(tag, $"Telegram rechazó la publicación: {error.Description}");
    }
}
