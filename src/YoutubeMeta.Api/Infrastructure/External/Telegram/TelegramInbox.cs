using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using YoutubeMeta.Api.Application.Inbox;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Common.Security;

namespace YoutubeMeta.Api.Infrastructure.External.Telegram;

/// <summary>
/// Telegram: mensajes privados al bot (la persona tiene que escribirle primero) y mensajes del grupo de discusión del
/// canal (los comentarios), donde el bot debe estar. Con dirección pública el bot usa webhook; sin ella (desarrollo) la
/// app pregunta con getUpdates. Los avisos se guardan en crudo con la clave «bot{credencial}:{update_id}»: así también
/// sirven para descubrir canales al conectar (getUpdates confirma lo leído).
/// </summary>
public sealed class TelegramInbox(InboxChannelServices services, TelegramBotClient telegram, TelegramBots bots, WebhookSignature signature, IMemoryCache cache)
    : InboxChannelBase(services)
{
    public const string WebhookPath = "/api/Webhook/Telegram/";
    /// <summary>Cursor cuando el bot usa webhook (no hay update_id que recordar).</summary>
    private const string WebhookCursor = "webhook";

    public override string Platform => Platforms.Telegram;

    public override InboxAccountStatus Inspect(InboxAccountRow account, InboxEnvironment environment) =>
        account.CredentialId is null
            ? new(true, true, InboxModes.None, "El canal no tiene bot. Vuelve a conectarlo con un bot de Ajustes.", InboxFixes.Reconnect)
            : new(true, true, environment.PublicUrl ? InboxModes.Webhook : InboxModes.Poll);

    public override async Task<string?> PrepareAsync(InboxAccountRow account, InboxEnvironment environment, CancellationToken cancellationToken)
    {
        if (await bots.GetAsync(account.CredentialId, cancellationToken) is not { } bot) return "El bot de este canal ya no existe en Ajustes.";
        var result = environment.PublicUrl
            ? await telegram.SetWebhookAsync(bot.BaseUrl, bot.Token, $"{environment.PublicBaseUrl}{WebhookPath}{bot.CredentialId}", signature.TelegramSecret(bot.CredentialId), cancellationToken)
            : await telegram.DeleteWebhookAsync(bot.BaseUrl, bot.Token, cancellationToken);
        return result.Ok ? null : TelegramPublisher.Friendly(result.Error!);
    }

    /// <summary>Con webhook: lo renueva una vez al día. Sin él: getUpdates desde el último update_id.</summary>
    public override async Task<InboxPollResult> PollAsync(InboxAccountRow account, InboxEnvironment environment, CancellationToken cancellationToken)
    {
        DateTime now = TimeClock.UtcNow;
        if (environment.PublicUrl || account.SyncCursor == WebhookCursor)
        {
            string? problem = await PrepareAsync(account, environment, cancellationToken);
            if (problem is not null) return InboxPollResult.Failed(account.SyncCursor, now.AddMinutes(10), problem);
            if (environment.PublicUrl) return InboxPollResult.Idle(WebhookCursor, now.AddDays(1));
        }

        if (await bots.GetAsync(account.CredentialId, cancellationToken) is not { } bot)
            return InboxPollResult.Failed(null, now.AddHours(1), "El bot de este canal ya no existe en Ajustes.");

        long? offset = long.TryParse(account.SyncCursor, out long last) ? last + 1 : null;
        var updates = await telegram.UpdatesAsync(bot.BaseUrl, bot.Token, offset, cancellationToken);
        var next = now.AddSeconds(Math.Max(environment.Settings.TelegramPollSeconds, 5));
        if (!updates.Ok) return InboxPollResult.Failed(account.SyncCursor, next, TelegramPublisher.Friendly(updates.Error!));

        var events = updates.Data!.Select(u => new InboxRawEvent($"{TelegramBotClient.EventKeyPrefix(bot.CredentialId)}{u.UpdateId}", u.Json)).ToList();
        string? cursor = updates.Data!.Count > 0 ? updates.Data.Max(u => u.UpdateId).ToString() : account.SyncCursor;
        return new InboxPollResult(events, cursor, next);
    }

    public override Task<IReadOnlyList<InboxUpdate>> ParseAsync(InboxEventRow inboxEvent, IReadOnlyList<InboxAccountRow> accounts, CancellationToken cancellationToken)
    {
        using var document = JsonDocument.Parse(inboxEvent.Payload);
        var message = Child(document.RootElement, "message");
        if (message.ValueKind != JsonValueKind.Object || CredentialOf(inboxEvent.EventKey) is not { } credentialId) return Empty;
        // Lo que el canal reenvía solo a su grupo de discusión es la publicación, no un comentario.
        if (Child(message, "is_automatic_forward").ValueKind == JsonValueKind.True) return Empty;

        var chat = Child(message, "chat");
        string chatId = Text(chat, "id") ?? string.Empty;
        string chatType = Text(chat, "type") ?? string.Empty;
        bool isPrivate = chatType == "private";
        if (chatId.Length == 0 || chatType == "channel") return Empty;

        // La cuenta: el chat conectado como destino o, si no, el canal principal de ese bot.
        var botAccounts = accounts.Where(a => a.Platform == Platform && a.CredentialId == credentialId && a.StatusCode == ConnectionStatus.Connected)
            .OrderByDescending(a => a.ExternalId == chatId).ThenByDescending(a => a.IsDefault).ThenBy(a => a.Id).ToList();
        if (botAccounts.FirstOrDefault() is not { } account || (isPrivate ? !account.InboxDirect : !account.InboxComments)) return Empty;

        var from = Child(message, "from");
        string? name = string.Join(' ', new[] { Text(from, "first_name"), Text(from, "last_name") }.Where(x => !string.IsNullOrEmpty(x)));
        string? handle = Text(from, "username") is { } u ? $"@{u}" : null;
        var contact = new InboxContact(Text(from, "id") ?? chatId, string.IsNullOrEmpty(name) ? handle : name, handle);

        var updates = new List<InboxUpdate>();
        string? body = Text(message, "text") ?? Text(message, "caption");
        // Abrió el chat con un enlace de invitación (t.me/bot?start=código): se vincula a su ficha y no se muestra el comando.
        if (isPrivate && InviteCode(body) is { } code)
        {
            updates.Add(new InboxReferral(account.Id, contact.ExternalId, code));
            body = StartedWithInvite;
        }

        updates.Add(new InboxIncoming(account.Id, isPrivate ? InboxKinds.Direct : InboxKinds.Group, chatId,
            isPrivate ? contact.Name : Text(chat, "title"), Text(message, "message_id") ?? inboxEvent.EventKey, InboxDirections.In,
            UnixSeconds(message, "date", TimeClock.UtcNow), body,
            isPrivate ? contact : null, AuthorName: contact.Name, AuthorExternalId: contact.ExternalId,
            ParentExternalId: Text(Child(message, "reply_to_message"), "message_id"),
            Link: !isPrivate && Text(chat, "username") is { } group ? $"https://t.me/{group}" : null)
        {
            Attachments = ReadAttachments(message)
        });
        return Task.FromResult<IReadOnlyList<InboxUpdate>>(updates);
    }

    /// <summary>Lo que se ve en la bandeja en lugar de «/start código».</summary>
    public const string StartedWithInvite = "👋 Abrió el chat con el enlace de invitación.";

    /// <summary>«/start inv…» → el código de la invitación; cualquier otro texto → null.</summary>
    public static string? InviteCode(string? text)
    {
        if (text is null || !text.StartsWith("/start ", StringComparison.Ordinal)) return null;
        string code = text["/start ".Length..].Trim();
        return InboxAgenda.IsInviteCode(code) ? code : null;
    }

    /// <summary>t.me/&lt;bot&gt;?start=código. El nombre del bot se pregunta a Telegram una vez por hora.</summary>
    public override async Task<string?> InviteLinkAsync(InboxAccountRow account, string code, CancellationToken cancellationToken)
    {
        if (await bots.GetAsync(account.CredentialId, cancellationToken) is not { } bot) return null;
        string key = $"inbox:telegram:bot:{bot.CredentialId}";
        if (!cache.TryGetValue(key, out string? username) || username is null)
        {
            var me = await telegram.GetMeAsync(bot.BaseUrl, bot.Token, cancellationToken);
            if (!me.Ok || string.IsNullOrEmpty(me.Data!.Username)) return null;
            username = me.Data.Username;
            cache.Set(key, username, TimeSpan.FromHours(1));
        }
        return $"https://t.me/{username}?start={code}";
    }

    public override async Task<PublishStep> SendAsync(InboxSendContext context, CancellationToken cancellationToken)
    {
        var item = context.Item;
        if (await bots.GetAsync(item.CredentialId, cancellationToken) is not { } bot)
            return PublishStep.Failed("NO_BOT", "El bot de este canal ya no existe en Ajustes. Vuelve a conectar el canal con un bot.");

        string chatId = item.ConversationExternalId;
        string text = item.Body?.Trim() ?? string.Empty;
        TelegramResult<TelegramMessage>? sent = null;

        // Las imágenes van juntas (foto o álbum); videos y PDF, de uno en uno. El texto, al final.
        var images = context.Media.Where(m => m.MediaKind == MediaKinds.Image).Select(m => new TelegramFile(m.Path, m.FileName, m.ContentType)).ToList();
        if (images.Count > 0)
        {
            sent = await telegram.SendFilesAsync(bot.BaseUrl, bot.Token, new TelegramFiles(chatId, images, string.Empty, false, false, false), _ => { }, cancellationToken);
            if (!sent.Ok) return TelegramPublisher.Classify(sent.Error!);
        }
        foreach (var media in context.Media.Where(m => m.MediaKind != MediaKinds.Image))
        {
            sent = media.MediaKind == MediaKinds.Video
                ? await telegram.SendVideoAsync(bot.BaseUrl, bot.Token,
                    new TelegramVideo(chatId, media.Path, media.FileName, media.ContentType, string.Empty, null, null, null, false, false), _ => { }, cancellationToken)
                : await telegram.SendFilesAsync(bot.BaseUrl, bot.Token,
                    new TelegramFiles(chatId, [new TelegramFile(media.Path, media.FileName, media.ContentType)], string.Empty, true, false, false), _ => { }, cancellationToken);
            if (!sent.Ok) return TelegramPublisher.Classify(sent.Error!);
        }
        if (text.Length > 0)
        {
            sent = await telegram.SendMessageAsync(bot.BaseUrl, bot.Token, chatId, text, false, false, cancellationToken, item.ParentExternalId);
            if (!sent.Ok) return TelegramPublisher.Classify(sent.Error!);
        }
        return PublishStep.Done(null, externalId: sent?.Data?.MessageId.ToString());
    }

    public override async Task<InboxFile?> DownloadAsync(ConnectionRow connection, string mediaId, CancellationToken cancellationToken)
    {
        if (await bots.GetAsync(connection.CredentialId, cancellationToken) is not { } bot) return null;
        return await telegram.DownloadAsync(bot.BaseUrl, bot.Token, mediaId, cancellationToken) is { } stream
            ? new InboxFile(stream, "application/octet-stream", null)
            : null;
    }

    private static readonly Task<IReadOnlyList<InboxUpdate>> Empty = Task.FromResult<IReadOnlyList<InboxUpdate>>([]);

    /// <summary>Credencial del bot a partir de la clave «bot{credencial}:{update_id}».</summary>
    public static int? CredentialOf(string eventKey) =>
        eventKey.StartsWith("bot", StringComparison.Ordinal) && eventKey.IndexOf(':') is > 3 and var colon && int.TryParse(eventKey[3..colon], out int id)
            ? id : null;

    private static IReadOnlyList<InboxAttachment> ReadAttachments(JsonElement message)
    {
        var list = new List<InboxAttachment>();
        // Las fotos llegan en varios tamaños: la última es la más grande.
        if (Child(message, "photo") is { ValueKind: JsonValueKind.Array } photos && photos.GetArrayLength() > 0)
            list.Add(new InboxAttachment { Kind = "image", MediaId = Text(photos[photos.GetArrayLength() - 1], "file_id"), ContentType = "image/jpeg" });
        foreach (var (field, kind) in new[] { ("document", "document"), ("video", "video"), ("voice", "audio"), ("audio", "audio"), ("sticker", "sticker"), ("animation", "video") })
            if (Child(message, field) is { ValueKind: JsonValueKind.Object } file)
                list.Add(new InboxAttachment { Kind = kind, MediaId = Text(file, "file_id"), Name = Text(file, "file_name"), ContentType = Text(file, "mime_type") });
        return list;
    }
}
