using YoutubeMeta.Api.Application.Inbox;
using YoutubeMeta.Api.Application.Metrics;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Application.Services;

namespace YoutubeMeta.Api.Application.Jobs;

/// <summary>
/// Un carril por plataforma más uno para las consultas de estado. Así una subida de 20 GB a YouTube no retrasa lo
/// programado en Telegram, Instagram o TikTok, ni deja caducar un contenedor de Instagram mientras espera.
/// </summary>
public sealed class VideoPublishJob(IServiceProvider rootServices, ILogger<VideoPublishJob> logger, IOptions<VideoPublishSettings> settings,
        IOptions<PlatformsSettings> platforms)
    : PeriodicBackgroundService(rootServices, logger)
{
    private readonly VideoPublishSettings _settings = settings.Value;

    protected override IEnumerable<JobLane> Lanes
    {
        get
        {
            var delay = TimeSpan.FromSeconds(Math.Max(_settings.DelaySeconds, 5));
            yield return new JobLane("poll", delay, _settings.RunOnStartup, (services, ct) =>
                StepAsync("poll", () => services.GetRequiredService<PublicationProcessor>().PollDueAsync(ct), ct));

            foreach (string platform in platforms.Value.Publishable)
                yield return new JobLane(platform.ToLowerInvariant(), delay, _settings.RunOnStartup, (services, ct) =>
                    StepAsync(platform, () => services.GetRequiredService<PublicationProcessor>().PublishDueAsync(platform, ct), ct));
        }
    }
}

/// <summary>
/// Borra subidas TUS caducadas o terminadas, miniaturas temporales huérfanas, el historial viejo y lo que caducó de la
/// bandeja; cancela lo pendiente de plataformas desactivadas.
/// </summary>
public sealed class StorageCleanupJob(IServiceProvider rootServices, ILogger<StorageCleanupJob> logger, IOptions<StorageCleanupSettings> settings)
    : PeriodicBackgroundService(rootServices, logger)
{
    protected override IEnumerable<JobLane> Lanes =>
    [
        new("cleanup", TimeSpan.FromMinutes(Math.Max(settings.Value.DelayMinutes, 5)), true, async (services, ct) =>
        {
            int removed = await services.GetRequiredService<VideoUploadService>()
                .CleanupAsync(TimeSpan.FromHours(settings.Value.TempPosterHours), ct);
            if (removed > 0) Logger.LogInformation("{Job}: {Removed} temporal(es) eliminados.", JobName, removed);

            var publications = services.GetRequiredService<PublicationService>();
            int events = await publications.PurgeEventsAsync(settings.Value.EventRetentionDays, ct);
            if (events > 0) Logger.LogInformation("{Job}: {Events} evento(s) de historial antiguos eliminados.", JobName, events);

            int cancelled = await publications.CancelDisabledAsync(ct);
            if (cancelled > 0) Logger.LogInformation("{Job}: {Count} publicación(es) de plataformas desactivadas canceladas.", JobName, cancelled);

            var (inboxEvents, messages) = await services.GetRequiredService<InboxProcessor>().PurgeAsync(ct);
            if (inboxEvents + messages > 0)
                Logger.LogInformation("{Job}: bandeja, {Events} aviso(s) y {Messages} mensaje(s) antiguos eliminados.", JobName, inboxEvents, messages);
        })
    ];
}

/// <summary>
/// Prueba cada conexión al menos una vez por semana: el refresh token de Google muere tras 6 meses sin uso y así
/// también se detecta pronto un token revocado. Revisa cada hora qué cuentas llevan más de DelayHours sin probarse,
/// así un despliegue o un reciclado no reinicia la cuenta atrás.
/// </summary>
public sealed class TokenKeepAliveJob(IServiceProvider rootServices, ILogger<TokenKeepAliveJob> logger, IOptions<TokenKeepAliveSettings> settings)
    : PeriodicBackgroundService(rootServices, logger)
{
    protected override IEnumerable<JobLane> Lanes =>
    [
        new("keepalive", TimeSpan.FromHours(1), true, (services, ct) =>
            services.GetRequiredService<ConnectionService>().KeepAliveAsync(TimeSpan.FromHours(Math.Max(settings.Value.DelayHours, 1)), ct))
    ];
}

/// <summary>Recoge vistas, «me gusta» y comentarios de lo publicado en los últimos 90 días (YouTube, Facebook, Instagram).</summary>
public sealed class MetricsJob(IServiceProvider rootServices, ILogger<MetricsJob> logger, IOptions<MetricsSettings> settings)
    : PeriodicBackgroundService(rootServices, logger)
{
    protected override IEnumerable<JobLane> Lanes =>
    [
        new("metrics", TimeSpan.FromMinutes(Math.Max(settings.Value.DelayMinutes, 10)), false, async (services, ct) =>
        {
            int saved = await services.GetRequiredService<MetricsService>().CollectDueAsync(Math.Clamp(settings.Value.Batch, 1, 500), ct);
            if (saved > 0) Logger.LogInformation("{Job}: métricas de {Saved} publicación(es) actualizadas.", JobName, saved);
        })
    ];
}

/// <summary>
/// Bandeja: entrada (avisos → conversaciones), envío (respuestas en cola) y consulta (lo que la plataforma no avisa).
/// Cada carril a su ritmo: una consulta lenta a YouTube no retrasa una respuesta de WhatsApp.
/// </summary>
public sealed class InboxJob(IServiceProvider rootServices, ILogger<InboxJob> logger, IOptions<InboxSettings> settings)
    : PeriodicBackgroundService(rootServices, logger)
{
    protected override IEnumerable<JobLane> Lanes
    {
        get
        {
            var delay = TimeSpan.FromSeconds(Math.Max(settings.Value.DelaySeconds, 2));
            yield return new JobLane("ingest", delay, true, (services, ct) =>
                StepAsync("ingest", () => services.GetRequiredService<InboxProcessor>().IngestDueAsync(ct), ct));
            yield return new JobLane("send", delay, true, (services, ct) =>
                StepAsync("send", () => services.GetRequiredService<InboxProcessor>().SendDueAsync(ct), ct));
            yield return new JobLane("poll", TimeSpan.FromSeconds(5), true, (services, ct) =>
                StepAsync("poll", () => services.GetRequiredService<InboxProcessor>().PollDueAsync(ct), ct));
        }
    }
}
