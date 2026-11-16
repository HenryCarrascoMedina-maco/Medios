using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;
using YoutubeMeta.Api.Infrastructure.Storage;

namespace YoutubeMeta.Api.Application.Publishing;

/// <summary>
/// Trabajo de un carril del job: reserva filas de la cola con lease, sube o consulta y cierra cada fila con un
/// único resultado. Lo propio de cada plataforma vive en su <see cref="IPlatformPublisher"/>; las transiciones de
/// estado, en <see cref="PublicationOutcomes"/>.
/// </summary>
public sealed class PublicationProcessor(
        PublicationRepository publications,
        VideoStorage storage,
        MediaLinks links,
        IEnumerable<IPlatformPublisher> publishers,
        IProgressNotifier notifier,
        IOptions<VideoPublishSettings> settings,
        ILogger<PublicationProcessor> logger)
{
    public static readonly string LeaseOwner = BuildLeaseOwner();

    private const int PollLeaseMinutes = 2;
    private static readonly TimeSpan VerifyTimeout = TimeSpan.FromMinutes(2);

    private readonly VideoPublishSettings _settings = settings.Value;
    private readonly Dictionary<string, IPlatformPublisher> _publishers = publishers.ToDictionary(p => p.Platform);

    /// <summary>
    /// Sube hasta BatchSize filas de una plataforma. Se reserva de UNA en una: una fila esperando su turno nunca
    /// tiene un lease que pueda vencer (y por tanto nadie puede cancelarla o tomarla mientras tanto).
    /// </summary>
    public async Task<int> PublishDueAsync(string platform, CancellationToken cancellationToken)
    {
        if (!_publishers.TryGetValue(platform, out var publisher)) return 0;

        int processed = 0;
        while (processed < publisher.BatchSize)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var due = await publications.DueList(platform, 1, LeaseOwner, _settings.LeaseMinutes, cancellationToken);
            if (due.Count == 0) break;

            var item = due[0];
            await NotifyAsync(item.Id, item.VideoId, item.ConnectionId, item.Target, PublicationStatus.Uploading, null);
            var step = await UploadAsync(publisher, item, cancellationToken);
            if (step.Outcome == PublishOutcome.Done)
                step = await WithFirstCommentAsync(publisher, step, item.Target, item.Options, item.ConnectionKey, item.AccountExternalId, item.CredentialId, null, cancellationToken);
            await CloseAsync(item.Id, item.VideoId, item.ConnectionId, item.Target, step,
                new AttemptContext(item.Target, item.Attempts, item.MaxAttempts, 0, IsPoll: false));
            processed++;
        }
        return processed;
    }

    public async Task<int> PollDueAsync(CancellationToken cancellationToken)
    {
        var due = await publications.PollDueList(_settings.PollBatch, LeaseOwner, PollLeaseMinutes, cancellationToken);
        foreach (var item in due)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var step = await PollAsync(item, cancellationToken);
            if (step.Outcome == PublishOutcome.Done && _publishers.TryGetValue(item.Target, out var publisher))
                step = await WithFirstCommentAsync(publisher, step, item.Target, item.Options, item.ConnectionKey, item.AccountExternalId, item.CredentialId, item.ExternalId, cancellationToken);
            await CloseAsync(item.Id, item.VideoId, item.ConnectionId, item.Target, step,
                new AttemptContext(item.Target, item.Attempts, item.MaxAttempts, item.PollCount, IsPoll: true));
        }
        return due.Count;
    }

    private async Task<PublishStep> UploadAsync(IPlatformPublisher publisher, PublicationDueItem item, CancellationToken cancellationToken)
    {
        string label = Platforms.Label(item.Target);
        if (item.ConnectionStatus != ConnectionStatus.Connected) return ReconnectStep(label);

        if (!PlatformCapabilities.ForAccount(item.Target, item.AccountExternalId).Kinds.Contains(item.PostKind))
            return PublishStep.Failed("UNSUPPORTED", $"{label} no admite publicaciones de tipo {PostKinds.Label(item.PostKind)} por API.");

        if (PrepareMedia(item) is { } missing) return missing;
        string path = item.Media.Count > 0 ? item.Media[0].FullPath : string.Empty;

        await using var heartbeat = new UploadHeartbeat(publications, notifier, logger, item, LeaseOwner, _settings, cancellationToken);
        try
        {
            // Un intento anterior llegó al paso irreversible y no terminó: antes de subir otra vez, se comprueba.
            if (item.CommitStartedAt is not null)
            {
                var verified = await VerifyAsync(publisher, item, cancellationToken);
                if (verified is not null) return verified;
                logger.LogInformation("Publicación {Id}: comprobado que no llegó a {Target}; se sube de nuevo.", item.Id, item.Target);
                item.SessionData = null;
            }

            return await publisher.UploadAsync(item, path, LeaseOwner, heartbeat);
        }
        catch (OperationCanceledException) when (heartbeat.LeaseLost)
        {
            return PublishStep.LeaseLost();
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // Timeout de HttpClient (no es un apagado): reintentable, salvo que ya estuviera publicando.
            logger.LogWarning("Publicación {Id}: tiempo de espera agotado con {Target}.", item.Id, item.Target);
            return heartbeat.Committing ? await VerifyAsync(publisher, item, cancellationToken) ?? PublishStep.Network(label) : PublishStep.Network(label);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Publicación {Id}: error al subir a {Target}.", item.Id, item.Target);
            return heartbeat.Committing ? await VerifyAsync(publisher, item, cancellationToken) ?? publisher.Classify(ex) : publisher.Classify(ex);
        }
    }

    /// <summary>Nunca lanza (salvo apagado): si la comprobación falla, el caso pasa a revisión con instrucciones.</summary>
    private async Task<PublishStep?> VerifyAsync(IPlatformPublisher publisher, PublicationDueItem item, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(VerifyTimeout);
        try
        {
            return await publisher.VerifyAsync(item, timeout.Token);
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Publicación {Id}: no se pudo comprobar si {Target} la publicó.", item.Id, item.Target);
            return PlatformPublisherBase.Unverifiable(Platforms.Label(item.Target));
        }
    }

    private async Task<PublishStep> PollAsync(PublicationPollItem item, CancellationToken cancellationToken)
    {
        string label = Platforms.Label(item.Target);
        if (item.UploadedAt is { } uploadedAt && TimeClock.UtcNow - uploadedAt > TimeSpan.FromHours(_settings.PollMaxHours))
            return PublishStep.Failed("PROCESSING_TIMEOUT",
                $"{label} lleva más de {_settings.PollMaxHours} h procesando el video. Ábrelo en {label} para ver su estado; «Reintentar» vuelve a consultarlo sin subirlo otra vez.");

        if (item.ConnectionStatus != ConnectionStatus.Connected) return ReconnectStep(label);

        if (!_publishers.TryGetValue(item.Target, out var publisher))
            return PublishStep.Failed("PLATFORM", $"No hay publicador para {item.Target}.");

        try
        {
            return await publisher.PollAsync(item, cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return PublishStep.StillProcessing();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Publicación {Id}: no se pudo consultar el estado en {Target}.", item.Id, item.Target);
            return PublishStep.StillProcessing();
        }
    }

    private static PublishStep ReconnectStep(string label) =>
        PublishStep.NeedsReconnect("CONNECTION", $"La cuenta de {label} necesita reconectarse. Hazlo en Conexiones y la publicación seguirá sola.");

    /// <summary>
    /// Ruta absoluta y, si el servidor tiene dirección pública, enlace firmado de cada archivo del post. Un archivo
    /// borrado del disco no se puede publicar: se dice cuál.
    /// </summary>
    private PublishStep? PrepareMedia(PublicationDueItem item)
    {
        foreach (var media in item.Media)
        {
            media.FullPath = storage.Resolve(media.StoragePath);
            if (!File.Exists(media.FullPath))
                return PublishStep.Failed("FILE_MISSING",
                    $"Uno de los archivos de la publicación ya no existe en el almacenamiento ({Path.GetFileName(media.StoragePath)}). Vuelve a subirlo a la biblioteca.");
            media.PublicUrl = links.PublicUrl(media.Id, Path.GetExtension(media.StoragePath), MediaLinks.PlatformLifetime);
        }
        return null;
    }

    /// <summary>Tras publicar, el primer comentario si se pidió. Si falla, la publicación queda hecha con un aviso.</summary>
    private async Task<PublishStep> WithFirstCommentAsync(IPlatformPublisher publisher, PublishStep step, string target, PublicationOptions options,
        string connectionKey, string accountExternalId, int? credentialId, string? previousExternalId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(options.FirstComment)) return step;
        string? postId = step.ExternalId ?? previousExternalId;
        if (string.IsNullOrEmpty(postId)) return step with { Warning = Join(step.Warning, FirstComments.Warning(target, "no se conoce el id de la publicación.")) };

        var request = new CommentRequest(target, connectionKey, accountExternalId, credentialId, postId, options.FirstComment.Trim());
        var result = await FirstComments.TryAsync(publisher, request, logger, cancellationToken);
        return result.CommentId is { } id
            ? step with { CommentId = id }
            : step with { Warning = Join(step.Warning, FirstComments.Warning(target, result.Error ?? "error desconocido.")) };
    }

    private static string Join(string? first, string second) => string.IsNullOrEmpty(first) ? second : $"{first} {second}";

    private static string BuildLeaseOwner()
    {
        string owner = $"{Environment.MachineName}:{Environment.ProcessId}:{Guid.NewGuid().ToString("N")[..8]}";
        return owner.Length <= 100 ? owner : owner[^100..];
    }

    private async Task CloseAsync(long id, int? videoId, int connectionId, string target, PublishStep step, AttemptContext context)
    {
        var result = PublicationOutcomes.ToResult(step, context, _settings.BackoffMinutes, TimeClock.UtcNow);
        if (result is null) return;

        // Sin token de cancelación: un resultado obtenido debe quedar guardado aunque el host se esté apagando.
        var row = await publications.Result(id, LeaseOwner, result, CancellationToken.None);
        if (row is null || row.Affected == 0)
        {
            logger.LogWarning("Publicación {Id}: el lease ya no era de este proceso; no se guardó el resultado.", id);
            return;
        }

        await NotifyAsync(id, videoId, connectionId, target, row.StatusCode, result.StatusCode is PublicationStatus.Done or PublicationStatus.Processing ? 100 : null);
    }

    private Task NotifyAsync(long id, int? videoId, int connectionId, string target, string status, int? percent) =>
        notifier.NotifyAsync(RealTimeEntities.VideoPublish, new { publicationId = id, videoId, connectionId, target, status, percent, isFinal = true });
}
