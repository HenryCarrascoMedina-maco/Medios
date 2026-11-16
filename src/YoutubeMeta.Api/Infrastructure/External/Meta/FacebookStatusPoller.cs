using YoutubeMeta.Api.Application.Publishing;

namespace YoutubeMeta.Api.Infrastructure.External.Meta;

public sealed class FacebookStatusPoller(MetaGraphClient graph, PublisherServices services)
{
    /// <summary>Meta procesa en segundo plano: el id llega enseguida, pero el video aún puede fallar.</summary>
    public async Task<PublishStep> PollAsync(PublicationPollItem item, CancellationToken cancellationToken)
    {
        string? pageToken = await services.TokenAsync(item.ConnectionKey, cancellationToken);
        if (pageToken is null)
            return PublishStep.NoToken("La Página de Facebook");

        var result = await graph.VideoStatusAsync(item.ExternalId, pageToken, cancellationToken);
        if (!result.Ok) return MetaErrorClassifier.Classify(result.Error!);

        var status = result.Data!;
        if (status.IsFailed || status.ErrorMessage != null)
            return PublishStep.Failed($"video_status:{status.VideoStatus}", status.ErrorMessage ?? "Facebook no pudo procesar el video.");

        if (status.VideoStatus == "ready" && status.IsPublished)
            return PublishStep.Done(status.PermalinkUrl ?? item.ExternalUrl,
                status.PublishStatus == "scheduled" ? "Programado: Facebook lo publicará a la hora indicada." : null);

        return PublishStep.StillProcessing();
    }
}
