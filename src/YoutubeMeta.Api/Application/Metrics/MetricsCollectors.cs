using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Infrastructure.External;
using YoutubeMeta.Api.Infrastructure.External.Linkedin;
using YoutubeMeta.Api.Infrastructure.External.Meta;
using YoutubeMeta.Api.Infrastructure.External.YouTube;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Application.Metrics;

/// <summary>Lee las métricas de lo ya publicado en una plataforma. null = no se pudieron leer (se reintenta mañana).</summary>
public interface IMetricsCollector
{
    string Platform { get; }

    Task<PublicationMetrics?> CollectAsync(MetricsDueItem item, CancellationToken cancellationToken);
}

/// <summary>videos.list?part=statistics: 1 unidad de cuota por video (con el permiso youtube.readonly ya concedido).</summary>
public sealed class YoutubeMetricsCollector(YoutubeClientFactory clients, ActivityRepository activity) : IMetricsCollector
{
    public string Platform => Platforms.YouTube;

    public async Task<PublicationMetrics?> CollectAsync(MetricsDueItem item, CancellationToken cancellationToken)
    {
        using var youtube = await clients.CreateAsync(item.ConnectionKey, TimeSpan.FromSeconds(30), cancellationToken);
        if (youtube is null) return null;

        var request = youtube.Videos.List("statistics");
        request.Id = item.ExternalId;
        var response = await request.ExecuteAsync(cancellationToken);
        await activity.QuotaAdd(QuotaBuckets.General, 1, item.ConnectionId, CancellationToken.None);

        var stats = response.Items?.FirstOrDefault()?.Statistics;
        return stats is null ? null : new PublicationMetrics((long?)stats.ViewCount, (long?)stats.LikeCount, (long?)stats.CommentCount);
    }
}

public abstract class MetaMetricsCollector(PublisherServices services) : IMetricsCollector
{
    public abstract string Platform { get; }

    protected abstract Task<MetaResult<PublicationMetrics>> EngagementAsync(string externalId, string token, CancellationToken cancellationToken);

    public async Task<PublicationMetrics?> CollectAsync(MetricsDueItem item, CancellationToken cancellationToken)
    {
        string? token = await services.TokenAsync(item.ConnectionKey, cancellationToken);
        if (token is null) return null;
        var result = await EngagementAsync(item.ExternalId, token, cancellationToken);
        return result.Ok ? result.Data : null;
    }
}

public sealed class FacebookMetricsCollector(MetaGraphClient graph, PublisherServices services) : MetaMetricsCollector(services)
{
    public override string Platform => Platforms.Facebook;

    protected override Task<MetaResult<PublicationMetrics>> EngagementAsync(string externalId, string token, CancellationToken cancellationToken) =>
        graph.VideoEngagementAsync(externalId, token, cancellationToken);
}

public sealed class InstagramMetricsCollector(MetaGraphClient graph, PublisherServices services) : MetaMetricsCollector(services)
{
    public override string Platform => Platforms.Instagram;

    protected override Task<MetaResult<PublicationMetrics>> EngagementAsync(string externalId, string token, CancellationToken cancellationToken) =>
        graph.MediaEngagementAsync(externalId, token, cancellationToken);
}

/// <summary>
/// LinkedIn: «me gusta» y comentarios solo en páginas de empresa (r_organization_social). En perfiles personales
/// LinkedIn exige un permiso restringido: se guarda vacío para no volver a preguntar cada día.
/// </summary>
public sealed class LinkedinMetricsCollector(LinkedinClient linkedin, LinkedinTokens tokens, PlatformKeys keys) : IMetricsCollector
{
    public string Platform => Platforms.LinkedIn;

    public async Task<PublicationMetrics?> CollectAsync(MetricsDueItem item, CancellationToken cancellationToken)
    {
        if (!item.AccountExternalId.StartsWith("urn:li:organization:", StringComparison.Ordinal)) return MetricsService.NoData;

        var access = await tokens.AccessAsync(item.ConnectionKey, cancellationToken);
        if (access.Token is not { } token) return null;

        string version = (await keys.LinkedinAsync(true, cancellationToken)).Settings.ApiVersion;
        var result = await linkedin.SocialSummaryAsync(item.ExternalId, token, version, cancellationToken);
        return result.Ok ? result.Data : null;
    }
}

/// <summary>Una vuelta del job de métricas: lo pendiente de cada plataforma, sin que un fallo pare a las demás.</summary>
public sealed class MetricsService(ActivityRepository activity, IEnumerable<IMetricsCollector> collectors, IOptions<PlatformsSettings> platforms,
    ILogger<MetricsService> logger)
{
    internal static readonly PublicationMetrics NoData = new(null, null, null);

    private readonly Dictionary<string, IMetricsCollector> _collectors = collectors.ToDictionary(c => c.Platform);

    public async Task<int> CollectDueAsync(int top, CancellationToken cancellationToken)
    {
        int saved = 0;
        foreach (var item in await activity.MetricsDue(top, cancellationToken))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!_collectors.TryGetValue(item.Target, out var collector)) continue;
            if (!platforms.Value.IsEnabled(item.Target))
            {
                await activity.MetricsSave(item.Id, NoData, cancellationToken);
                continue;
            }
            try
            {
                var metrics = await collector.CollectAsync(item, cancellationToken);
                // Aunque no haya datos se guarda la fecha: así no se insiste hasta mañana.
                await activity.MetricsSave(item.Id, metrics ?? NoData, cancellationToken);
                if (metrics is not null) saved++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Métricas de la publicación {Id} en {Target}: no se pudieron leer.", item.Id, item.Target);
            }
        }
        return saved;
    }
}
