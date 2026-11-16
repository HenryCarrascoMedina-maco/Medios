using Microsoft.Extensions.Diagnostics.HealthChecks;
using YoutubeMeta.Api.Application.Jobs;

namespace YoutubeMeta.Api.Infrastructure.Data;

public sealed class DatabaseHealthCheck(DbExecuter db) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            await db.Ping(cancellationToken);
            return HealthCheckResult.Healthy();
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("La base de datos no responde.", ex);
        }
    }
}

/// <summary>
/// El job de publicación sigue vivo: cada carril terminó una vuelta hace poco. Un carril con una subida larga en
/// curso no termina vuelta, por eso el margen es amplio y solo degrada (no tumba) el estado.
/// </summary>
public sealed class PublishJobHealthCheck(IOptions<VideoPublishSettings> settings) : IHealthCheck
{
    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        if (!settings.Value.Enabled) return Task.FromResult(HealthCheckResult.Healthy("Job desactivado."));

        var poll = JobHeartbeats.Snapshot().GetValueOrDefault($"{nameof(VideoPublishJob)}/poll");
        var limit = TimeSpan.FromSeconds(Math.Max(settings.Value.DelaySeconds, 5) * 10);
        return Task.FromResult(poll != default && TimeClock.UtcNow - poll <= limit
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Degraded("El job de publicación no completa vueltas (¿IIS detuvo el proceso?)."));
    }
}
