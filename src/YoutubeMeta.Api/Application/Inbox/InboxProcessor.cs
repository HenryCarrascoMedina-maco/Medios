using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;
using YoutubeMeta.Api.Infrastructure.Storage;

namespace YoutubeMeta.Api.Application.Inbox;

/// <summary>
/// Lo que hace el job de la bandeja, en tres carriles independientes:
/// <list type="bullet">
/// <item>Entrada: avisos en crudo (webhooks y consultas) → adaptador de su plataforma → conversación y mensaje.</item>
/// <item>Envío: respuestas en cola → plataforma, con reintentos, «no se sabe si llegó» y el motivo de cada fallo.</item>
/// <item>Consulta: lo que la plataforma no avisa (YouTube, Teams, Telegram sin webhook) y el mantenimiento de webhooks.</item>
/// </list>
/// Mismo patrón de lease que el job de publicación: un proceso que muere no deja nada a medias para siempre.
/// </summary>
public sealed class InboxProcessor(
        InboxRepository inbox,
        InboxChannels channels,
        ConnectionRepository connections,
        VideoRepository videos,
        VideoStorage storage,
        MediaLinks links,
        IHttpClientFactory httpClients,
        IProgressNotifier notifier,
        ILogger<InboxProcessor> logger)
{
    public static readonly string LeaseOwner = $"INBOX:{Environment.MachineName}:{Environment.ProcessId}:{Guid.NewGuid().ToString("N")[..8]}";

    private InboxSettings Settings => channels.Settings;

    #region ENTRADA
    public async Task<int> IngestDueAsync(CancellationToken cancellationToken)
    {
        var due = await inbox.EventsDue(Math.Max(Settings.Batch, 1), LeaseOwner, Math.Max(Settings.LeaseMinutes, 1), Math.Max(Settings.MaxAttempts, 1), cancellationToken);
        if (due.Count == 0) return 0;

        var accounts = await inbox.Accounts(cancellationToken);
        var changed = new Dictionary<long, bool>();
        foreach (var inboxEvent in due)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                if (channels.For(inboxEvent.Platform) is { } channel)
                    foreach (var update in await channel.ParseAsync(inboxEvent, accounts, cancellationToken))
                        await ApplyAsync(inboxEvent.Platform, update, changed, cancellationToken);
                await inbox.EventResult(inboxEvent.Id, LeaseOwner, InboxEventStatus.Done, null, null, CancellationToken.None);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                logger.LogWarning(ex, "Bandeja: no se pudo procesar el aviso {Id} de {Platform} (intento {Attempt}).", inboxEvent.Id, inboxEvent.Platform, inboxEvent.Attempts);
                await inbox.EventResult(inboxEvent.Id, LeaseOwner, InboxEventStatus.Failed, ex.Message,
                    TimeClock.UtcNow.AddSeconds(Math.Max(Settings.BackoffSeconds, 5) * inboxEvent.Attempts), CancellationToken.None);
            }
        }

        foreach (var (conversationId, isNew) in changed) await NotifyAsync(conversationId, isNew, cancellationToken);
        return due.Count;
    }

    private async Task ApplyAsync(string platform, InboxUpdate update, Dictionary<long, bool> changed, CancellationToken cancellationToken)
    {
        switch (update)
        {
            case InboxIncoming message:
                if (await inbox.Ingest(message, cancellationToken) is { } result)
                {
                    changed[result.ConversationId] = changed.GetValueOrDefault(result.ConversationId) || (result.IsNew && message.Direction == InboxDirections.In);
                    if (result.IsNew && message.Direction == InboxDirections.In && message.Attachments.Count > 0 && Settings.KeepReceivedFiles)
                        await KeepFilesAsync(platform, message, result.MessageId, cancellationToken);
                }
                break;
            case InboxStatusChange status:
                if (await inbox.StatusSave(platform, status.ExternalId, status.Status, status.Error, cancellationToken) is { } conversationId)
                    changed.TryAdd(conversationId, false);
                break;
            case InboxReferral referral:
                if (!await inbox.InviteClaim(referral, cancellationToken))
                    logger.LogInformation("Bandeja: invitación {Code} de {Platform} caducada, ya usada o desconocida.", referral.Code, platform);
                break;
        }
    }

    /// <summary>
    /// Copia de los archivos recibidos en el almacenamiento propio (inbox/yyyy/MM/): las redes los caducan. Lo que no se
    /// puede copiar (muy grande, error de red) se sigue abriendo desde la red mientras exista; no detiene la entrada.
    /// </summary>
    private async Task KeepFilesAsync(string platform, InboxIncoming message, long messageId, CancellationToken cancellationToken)
    {
        long maxBytes = Math.Max(Settings.KeepFileMaxMb, 1) * 1024L * 1024L;
        var connection = await connections.Get(message.ConnectionId, cancellationToken);
        var kept = new List<InboxAttachment>();
        bool any = false;
        foreach (var attachment in message.Attachments)
        {
            try
            {
                InboxFile? file = attachment switch
                {
                    { MediaId: { } mediaId } when connection is not null && channels.For(platform) is { } channel =>
                        await channel.DownloadAsync(connection, mediaId, cancellationToken),
                    { Url: { } url } when Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps =>
                        await DownloadUrlAsync(uri, cancellationToken),
                    _ => null
                };
                string? stored = file is null ? null : await SaveCopyAsync(file, attachment, maxBytes, cancellationToken);
                kept.Add(stored is null ? attachment : CopyWith(attachment, stored, file!.ContentType));
                any |= stored is not null;
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                logger.LogWarning(ex, "Bandeja: no se pudo guardar la copia de un adjunto del mensaje {Id}.", messageId);
                kept.Add(attachment);
            }
        }
        if (any) await inbox.MessageAttachmentsSave(messageId, kept, cancellationToken);
    }

    private async Task<InboxFile?> DownloadUrlAsync(Uri uri, CancellationToken cancellationToken)
    {
        var response = await httpClients.CreateClient(HttpClients.Meta).GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode) return null;
        return new InboxFile(await response.Content.ReadAsStreamAsync(cancellationToken),
            response.Content.Headers.ContentType?.MediaType ?? "application/octet-stream", response.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
    }

    /// <summary>Guarda el archivo (si no pasa del límite) y devuelve su ruta relativa; null si era demasiado grande.</summary>
    private async Task<string?> SaveCopyAsync(InboxFile file, InboxAttachment attachment, long maxBytes, CancellationToken cancellationToken)
    {
        DateTime now = TimeClock.UtcNow;
        string extension = Path.GetExtension(attachment.Name ?? file.FileName ?? string.Empty) is { Length: > 1 and <= 10 } ext ? ext.ToLowerInvariant() : ExtensionOf(attachment.ContentType ?? file.ContentType);
        string relative = Path.Combine(KeptFilesFolder, now.ToString("yyyy"), now.ToString("MM"), $"{Guid.NewGuid():N}{extension}");
        string path = storage.Resolve(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        await using (file.Content)
        {
            await using var target = File.Create(path);
            var buffer = new byte[81920];
            long total = 0;
            int read;
            while ((read = await file.Content.ReadAsync(buffer, cancellationToken)) > 0)
            {
                total += read;
                if (total > maxBytes) break;
                await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }
            if (total <= maxBytes) return relative;
        }
        storage.TryDelete(relative);
        return null;
    }

    private static InboxAttachment CopyWith(InboxAttachment attachment, string storedPath, string contentType) => new()
    {
        Kind = attachment.Kind,
        Name = attachment.Name,
        Url = attachment.Url,
        MediaId = attachment.MediaId,
        StoredPath = storedPath,
        ContentType = attachment.ContentType ?? (contentType == "application/octet-stream" ? null : contentType)
    };

    private static string ExtensionOf(string? contentType) => contentType?.Split(';')[0].Trim().ToLowerInvariant() switch
    {
        "image/jpeg" => ".jpg",
        "image/png" => ".png",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        "video/mp4" => ".mp4",
        "audio/ogg" => ".ogg",
        "audio/mpeg" => ".mp3",
        "application/pdf" => ".pdf",
        _ => ".bin"
    };

    /// <summary>Carpeta de las copias de archivos recibidos dentro de Storage:Root.</summary>
    public const string KeptFilesFolder = "inbox";
    #endregion

    #region ENVÍO
    public async Task<int> SendDueAsync(CancellationToken cancellationToken)
    {
        var due = await inbox.SendDue(Math.Max(Settings.Batch, 1), LeaseOwner, Math.Max(Settings.LeaseMinutes, 1), cancellationToken);
        foreach (var item in due)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var step = await SendAsync(item, cancellationToken);
            var (status, next) = Outcome(step, item.Attempts, Settings);
            if (step.Outcome != PublishOutcome.LeaseLost
                && await inbox.SendResult(item.Id, LeaseOwner, status, step.ExternalId, status == InboxMessageStatus.Sent ? null : step.Message, next, CancellationToken.None) is { } conversationId)
                await NotifyAsync(conversationId, false, cancellationToken);
        }
        return due.Count;
    }

    private async Task<PublishStep> SendAsync(InboxSendItem item, CancellationToken cancellationToken)
    {
        if (channels.For(item.Platform) is not { } channel)
            return PublishStep.Failed("PLATFORM_DISABLED", $"{Platforms.Label(item.Platform)} no está disponible en la bandeja de esta instalación.");
        if (item.ConnectionStatus != ConnectionStatus.Connected)
            return PublishStep.NeedsReconnect("ACCOUNT", $"{item.AccountName} necesita reconectarse en Conexiones. Después pulsa «Reintentar».");

        try
        {
            var (media, missing) = await MediaAsync(item.SendOptions.MediaIds, cancellationToken);
            if (missing is not null) return PublishStep.Failed("FILE_MISSING", missing);

            // La ventana se mira al enviar (el mensaje pudo esperar en la cola).
            var window = InboxRules.Window(item.Platform, item.Kind, item.LastInboundAt, TimeClock.UtcNow, Settings.MetaHumanAgentTag);
            return await channel.SendAsync(new InboxSendContext(item, media, window), cancellationToken);
        }
        catch (HttpRequestException ex)
        {
            // La petición pudo llegar a la plataforma: no se reenvía sola.
            logger.LogWarning(ex, "Bandeja: se cortó el envío del mensaje {Id} a {Platform}.", item.Id, item.Platform);
            return UncertainStep(item.Platform);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            logger.LogError(ex, "Bandeja: error inesperado al enviar el mensaje {Id} a {Platform}.", item.Id, item.Platform);
            return PublishStep.Failed("UNEXPECTED", $"Error inesperado al enviar a {Platforms.Label(item.Platform)} ({ex.GetType().Name}). Pulsa «Reintentar».");
        }
    }

    private static PublishStep UncertainStep(string platform) => PublishStep.NeedsReview("UNCERTAIN",
        $"Se cortó la comunicación con {Platforms.Label(platform)} mientras se enviaba y no se puede saber si llegó. " +
        "Míralo en la plataforma: si ya aparece, pulsa «Ya se envió»; si no, «Reintentar».");

    /// <summary>Paso de la plataforma → estado del mensaje y, si se reintenta, cuándo (lo transitorio, hasta MaxAttempts).</summary>
    public static (string Status, DateTime? Next) Outcome(PublishStep step, int attempts, InboxSettings settings) => step.Outcome switch
    {
        PublishOutcome.Done or PublishOutcome.Processing => (InboxMessageStatus.Sent, null),
        PublishOutcome.NeedsReview => (InboxMessageStatus.NeedsReview, null),
        PublishOutcome.Retry or PublishOutcome.Restart or PublishOutcome.WaitQuota or PublishOutcome.StillProcessing when attempts < settings.MaxAttempts =>
            (InboxMessageStatus.Queued, step.NextAttemptAt ?? TimeClock.UtcNow.AddSeconds(Math.Max(settings.BackoffSeconds, 5) * attempts)),
        _ => (InboxMessageStatus.Failed, null)
    };

    private async Task<(IReadOnlyList<InboxMediaFile> Media, string? Missing)> MediaAsync(IReadOnlyList<int> ids, CancellationToken cancellationToken)
    {
        var list = new List<InboxMediaFile>();
        foreach (int id in ids)
        {
            var file = await videos.GetFile(id, cancellationToken);
            string? path = file is null ? null : storage.Resolve(file.StoragePath);
            if (file is null || !File.Exists(path))
                return ([], "Uno de los archivos adjuntos ya no existe en la biblioteca. Quita el adjunto y vuelve a enviar.");
            list.Add(new InboxMediaFile(file.Id, path!, file.OriginalFileName, file.ContentType, file.MediaKind,
                links.PublicUrl(file.Id, Path.GetExtension(file.StoragePath), MediaLinks.PlatformLifetime)));
        }
        return (list, null);
    }
    #endregion

    #region CONSULTA PERIÓDICA
    /// <summary>
    /// Cuentas cuya vuelta toca (una por SyncKey: los canales de un mismo bot de Telegram comparten una). Las que no
    /// pueden recibir o tienen la bandeja apagada no gastan cuota.
    /// </summary>
    public async Task<int> PollDueAsync(CancellationToken cancellationToken)
    {
        DateTime now = TimeClock.UtcNow;
        var environment = await channels.EnvironmentAsync(cancellationToken);
        var groups = (await inbox.Accounts(cancellationToken))
            .Where(a => a.StatusCode == ConnectionStatus.Connected && (a.InboxDirect || a.InboxComments))
            .GroupBy(a => a.SyncKey)
            .Select(g => g.OrderByDescending(a => a.IsDefault).ThenBy(a => a.Id).First())
            .Where(a => a.NextRunAt is null || a.NextRunAt <= now)
            .ToList();

        int saved = 0;
        foreach (var account in groups)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (channels.For(account.Platform) is not { } channel) continue;
            var status = channel.Inspect(account, environment);
            if (status.Mode == InboxModes.None || status.Problem is not null)
            {
                await inbox.SyncSave(account.SyncKey, account.SyncCursor, now.AddHours(1), false, status.Problem, CancellationToken.None);
                continue;
            }

            InboxPollResult result;
            try
            {
                result = await channel.PollAsync(account, environment, cancellationToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                logger.LogWarning(ex, "Bandeja: falló la consulta de {Platform} «{Name}».", account.Platform, account.Name);
                result = InboxPollResult.Failed(account.SyncCursor, now.AddMinutes(10), $"No se pudo consultar {Platforms.Label(account.Platform)} ({ex.GetType().Name}). Se reintenta solo.");
            }

            foreach (var raw in result.Events)
                if (await inbox.EventSave(account.Platform, raw.Key, raw.Payload, cancellationToken)) saved++;
            await inbox.SyncSave(account.SyncKey, result.Cursor, result.NextRunAt, result.Error is null, result.Error, CancellationToken.None);
        }
        return saved;
    }
    #endregion

    #region RETENCIÓN
    public async Task<(int Events, int Messages)> PurgeAsync(CancellationToken cancellationToken)
    {
        DateTime now = TimeClock.UtcNow;
        DateTime messagesBefore = now.AddMonths(-Math.Max(Settings.MessageRetentionMonths, 1));
        var result = await inbox.Purge(now.AddDays(-Math.Max(Settings.EventRetentionDays, 1)), messagesBefore, cancellationToken);
        PurgeKeptFiles(messagesBefore);
        return result;
    }

    /// <summary>
    /// Copias de archivos recibidos de meses ya fuera de la retención (inbox/yyyy/MM/). Se borra el mes entero cuando
    /// termina antes del corte: sus mensajes ya se borraron.
    /// </summary>
    private void PurgeKeptFiles(DateTime before)
    {
        string root = Path.Combine(storage.Root, KeptFilesFolder);
        if (!Directory.Exists(root)) return;
        foreach (string yearDirectory in Directory.EnumerateDirectories(root))
            foreach (string monthDirectory in Directory.EnumerateDirectories(yearDirectory))
            {
                if (!int.TryParse(Path.GetFileName(yearDirectory), out int year) || !int.TryParse(Path.GetFileName(monthDirectory), out int month)
                    || month is < 1 or > 12 || new DateTime(year, month, 1).AddMonths(1) > before) continue;
                try
                {
                    Directory.Delete(monthDirectory, true);
                }
                catch (IOException ex)
                {
                    logger.LogWarning(ex, "Bandeja: no se pudo borrar la carpeta de copias {Folder}.", monthDirectory);
                }
            }
    }
    #endregion

    private Task NotifyAsync(long conversationId, bool isNew, CancellationToken cancellationToken) =>
        notifier.NotifyAsync(RealTimeEntities.Inbox, new { conversationId, isNew }, cancellationToken);
}
