using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Infrastructure.External.YouTube;

public sealed class YoutubeStatusPoller(YoutubeClientFactory clients, ActivityRepository activity)
{
    /// <summary>videos.list(status, processingDetails): 1 unidad de cuota por consulta.</summary>
    public async Task<PublishStep> PollAsync(PublicationPollItem item, CancellationToken cancellationToken)
    {
        using var youtube = await clients.CreateAsync(item.ConnectionKey, TimeSpan.FromSeconds(60), cancellationToken);
        if (youtube is null)
            return PublishStep.NeedsReconnect("NO_TOKEN", "El canal de YouTube no tiene un acceso válido. Vuelve a conectarlo.");

        var request = youtube.Videos.List("status,processingDetails");
        request.Id = item.ExternalId;

        Google.Apis.YouTube.v3.Data.VideoListResponse response;
        try
        {
            response = await request.ExecuteAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return YoutubeErrorClassifier.Classify(ex);
        }
        finally
        {
            await activity.QuotaAdd(QuotaBuckets.General, 1, item.ConnectionId, CancellationToken.None);
        }

        var video = response.Items?.FirstOrDefault();
        if (video is null) return PublishStep.StillProcessing();

        string? upload = video.Status?.UploadStatus;
        string? processing = video.ProcessingDetails?.ProcessingStatus;

        if (upload == "failed") return PublishStep.Failed($"failed:{video.Status!.FailureReason}", FailureMessage(video.Status.FailureReason));
        if (upload == "rejected") return PublishStep.Failed($"rejected:{video.Status!.RejectionReason}", RejectionMessage(video.Status.RejectionReason));
        if (upload == "deleted") return PublishStep.Failed("deleted", "El video se borró de YouTube.");
        if (processing is "failed" or "terminated")
            return PublishStep.Failed($"processing:{video.ProcessingDetails!.ProcessingFailureReason}", "YouTube no pudo procesar el video. Revisa el formato (MP4, H.264, AAC).");

        if (processing == "succeeded" || upload == "processed")
        {
            string expected = item.PublishAt is null ? item.PrivacyStatus : PrivacyStatus.Private;
            string? actual = video.Status?.PrivacyStatus;
            string? warning = actual != null && actual != expected ? $"La configuración de la cuenta dejó el video como «{actual}»." : null;
            return PublishStep.Done(item.ExternalUrl ?? $"https://youtu.be/{item.ExternalId}", warning);
        }

        return PublishStep.StillProcessing();
    }

    private static string FailureMessage(string? reason) => reason switch
    {
        "codec" or "conversion" or "invalidFile" => "YouTube no reconoce el formato del archivo. Recodifica a MP4 (H.264 + AAC).",
        "tooSmall" or "emptyFile" => "El archivo está vacío o dañado.",
        "uploadAborted" => "La subida se interrumpió en YouTube. Reintenta la publicación.",
        _ => $"La subida falló en YouTube ({reason})."
    };

    private static string RejectionMessage(string? reason) => reason switch
    {
        "duplicate" => "YouTube lo rechazó por duplicado: el video ya existe en el canal.",
        "length" => "El video supera la duración permitida. Verifica el canal por teléfono para subir videos de más de 15 minutos.",
        "copyright" or "claim" or "trademark" or "legal" => "YouTube lo rechazó por derechos de autor o motivos legales.",
        "inappropriate" or "termsOfUse" => "YouTube lo rechazó por incumplir sus normas.",
        "uploaderAccountClosed" or "uploaderAccountSuspended" => "La cuenta de YouTube está cerrada o suspendida.",
        _ => $"YouTube rechazó el video ({reason})."
    };
}
