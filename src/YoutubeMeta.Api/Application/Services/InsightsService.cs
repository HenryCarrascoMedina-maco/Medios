using System.Globalization;
using YoutubeMeta.Api.Application.Jobs;
using YoutubeMeta.Api.Infrastructure.External;
using YoutubeMeta.Api.Infrastructure.Repositories;
using YoutubeMeta.Api.Infrastructure.Storage;

namespace YoutubeMeta.Api.Application.Services;

/// <summary>Resultados (publicaciones, éxito, métricas) y salud del sistema para el panel.</summary>
public sealed class InsightsService(
        ActivityRepository activity,
        InboxRepository inbox,
        IOptions<PlatformsSettings> platforms,
        VideoRepository videos,
        VideoStorage storage,
        IOptions<VideoPublishSettings> publishSettings,
        PlatformKeys keys,
        ExceptionHelper exception)
{
    /// <summary>LinkedIn retira cada versión de su API al cabo de un año aproximadamente: se avisa a los 10 meses.</summary>
    public const int LinkedinVersionWarnMonths = 10;

    /// <summary>El secreto de la app de Entra caduca (máx. 24 meses): aviso 30 días antes y error al caducar.</summary>
    public static (bool IsError, string Message)? TeamsSecretAlert(DateTime? expiresAt, DateTime today)
    {
        if (expiresAt is not { } at) return null;
        int days = (int)Math.Floor((at.Date - today.Date).TotalDays);
        if (days < 0) return (true, "El secreto de la app de Teams (Microsoft Entra) caducó: crea uno nuevo en Entra y pégalo en Ajustes › Plataformas › Teams.");
        if (days <= 30) return (false, $"El secreto de la app de Teams caduca en {days} días. Crea uno nuevo en Entra y actualízalo en Ajustes antes de esa fecha.");
        return null;
    }

    /// <summary>Meses desde la versión AAAAMM hasta hoy (null = formato no válido).</summary>
    public static int? LinkedinVersionAgeMonths(string version, DateTime today) =>
        DateTime.TryParseExact(version, "yyyyMM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var v)
            ? (today.Year - v.Year) * 12 + today.Month - v.Month
            : null;

    public Task<CustomTransactionResponse<InsightsResponse>> Insights(InsightsQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<InsightsResponse>>(async () =>
        {
            int days = Math.Clamp(query.Days, 1, 365);
            DateTime from = TimeClock.UtcNow.Date.AddDays(-days + 1);
            var (daily, accounts) = await activity.Insights(from, cancellationToken);
            var (inboxDaily, inboxPlatforms) = await inbox.Stats(from, cancellationToken);
            var answered = inboxPlatforms.Where(p => p.AvgResponseMinutes is not null && p.Sent > 0).ToList();

            int published = accounts.Sum(a => a.Published);
            int failed = accounts.Sum(a => a.Failed);
            var timed = accounts.Where(a => a.AvgMinutes is not null && a.Published > 0).ToList();

            return CustomTransactionResponse<InsightsResponse>.Ok(new InsightsResponse
            {
                Days = days,
                Published = published,
                Failed = failed,
                SuccessRate = published + failed == 0 ? null : Math.Round(100.0 * published / (published + failed), 1),
                Views = accounts.Sum(a => a.Views ?? 0),
                Likes = accounts.Sum(a => a.Likes ?? 0),
                Comments = accounts.Sum(a => a.Comments ?? 0),
                AvgMinutes = timed.Count == 0 ? null : Math.Round(timed.Sum(a => a.AvgMinutes!.Value * a.Published) / timed.Sum(a => a.Published), 1),
                Daily = daily,
                Accounts = accounts,
                Inbox = new InboxStats
                {
                    Received = inboxPlatforms.Sum(p => p.Received),
                    Sent = inboxPlatforms.Sum(p => p.Sent),
                    AvgResponseMinutes = answered.Count == 0 ? null
                        : Math.Round(answered.Sum(p => p.AvgResponseMinutes!.Value * p.Sent) / answered.Sum(p => p.Sent), 1),
                    Daily = inboxDaily,
                    Platforms = inboxPlatforms
                }
            });
        });

    /// <summary>Estado general con frases de qué mirar. Lo usa el panel; /health solo da el estado.</summary>
    public Task<CustomTransactionResponse<SystemHealthResponse>> Health(CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<SystemHealthResponse>>(async () =>
        {
            var queue = await activity.Health(cancellationToken);
            var (totals, _) = await activity.Quota(cancellationToken);
            int Units(string bucket) => totals.FirstOrDefault(t => t.Bucket == bucket)?.Units ?? 0;

            var health = new SystemHealthResponse
            {
                Queue = queue,
                YoutubeUploadsUsed = Units(QuotaBuckets.Uploads),
                YoutubeUploadsLimit = QuotaBuckets.UploadsLimit,
                YoutubeUnitsUsed = Units(QuotaBuckets.General),
                YoutubeUnitsLimit = QuotaBuckets.GeneralLimit,
                StorageUsedBytes = await videos.UsedBytes(cancellationToken),
                StorageFreeBytes = storage.FreeBytes(),
                JobLanes = JobHeartbeats.Snapshot()
            };

            var warn = new List<string>();
            var error = new List<string>();
            if (queue.StuckUploads > 0) warn.Add($"{queue.StuckUploads} subida(s) interrumpida(s): el job las retoma solo en unos minutos.");
            if (queue.OldestDueMinutes > 30) warn.Add($"Hay publicaciones esperando turno desde hace {queue.OldestDueMinutes} min.");
            if (queue.NeedsReview > 0) error.Add($"{queue.NeedsReview} publicación(es) necesitan que confirmes si ya están publicadas.");
            if (queue.ConnectionsNeedingReconnect > 0) error.Add($"{queue.ConnectionsNeedingReconnect} cuenta(s) necesitan reconectarse en Conexiones.");
            if (queue.ConnectionsFailingTest > 0) warn.Add($"{queue.ConnectionsFailingTest} cuenta(s) fallaron la última prueba de conexión.");
            if (queue.TokensExpiringSoon > 0) warn.Add($"{queue.TokensExpiringSoon} acceso(s) caducan en menos de 7 días.");
            if (queue.FailedLast7Days > 0) warn.Add($"{queue.FailedLast7Days} publicación(es) fallaron en los últimos 7 días.");
            if (health.StorageFreeBytes < 10L * 1024 * 1024 * 1024) warn.Add("Queda menos de 10 GB libres en el almacenamiento.");
            if (health.YoutubeUnitsUsed >= health.YoutubeUnitsLimit * 0.9) warn.Add("La cuota diaria de YouTube está casi agotada.");

            if (queue.InboxEventsFailed > 0) warn.Add($"{queue.InboxEventsFailed} aviso(s) de la bandeja no se pudieron procesar en 7 días: revisa el registro.");
            if (queue.InboxSendProblems > 0) warn.Add($"{queue.InboxSendProblems} respuesta(s) de la bandeja fallaron o necesitan que confirmes si se enviaron.");
            if (queue.InboxSyncErrors > 0) warn.Add($"{queue.InboxSyncErrors} cuenta(s) no pueden recibir en la bandeja: mira Configuración › Bandeja.");

            if (TeamsSecretAlert((await keys.TeamsAsync(cancellationToken)).Settings.SecretExpiresAt, TimeClock.UtcNow) is { } teamsAlert)
                (teamsAlert.IsError ? error : warn).Add(teamsAlert.Message);

            var linkedin = await keys.LinkedinAsync(false, cancellationToken);
            var linkedinOrg = await keys.LinkedinAsync(true, cancellationToken);
            if (platforms.Value.IsEnabled(Platforms.LinkedIn) && (linkedin.Source != CredentialSources.None || linkedinOrg.Source != CredentialSources.None))
            {
                string version = linkedin.Settings.ApiVersion;
                int? age = LinkedinVersionAgeMonths(version, TimeClock.UtcNow);
                if (age is null) warn.Add($"La versión de la API de LinkedIn («{version}») no es válida: usa el formato AAAAMM en Linkedin:ApiVersion.");
                else if (age >= LinkedinVersionWarnMonths)
                    warn.Add($"La versión {version} de la API de LinkedIn tiene {age} meses y LinkedIn la retirará pronto. Sube Linkedin:ApiVersion a una más reciente (ver la guía).");
            }

            var settings = publishSettings.Value;
            if (settings.Enabled)
            {
                var poll = health.JobLanes.GetValueOrDefault($"{nameof(VideoPublishJob)}/poll");
                if (poll == default || TimeClock.UtcNow - poll > TimeSpan.FromSeconds(Math.Max(settings.DelaySeconds, 5) * 10))
                    error.Add("El job de publicación no está dando vueltas. En IIS revisa AlwaysRunning e Idle Time-out = 0.");
            }

            health.Alerts = [.. error, .. warn];
            health.Status = error.Count > 0 ? "error" : warn.Count > 0 ? "warn" : "ok";
            return CustomTransactionResponse<SystemHealthResponse>.Ok(health);
        });
}
