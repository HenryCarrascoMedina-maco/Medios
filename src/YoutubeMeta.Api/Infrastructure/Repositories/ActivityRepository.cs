using YoutubeMeta.Api.Infrastructure.Data;

namespace YoutubeMeta.Api.Infrastructure.Repositories;

/// <summary>Campana de avisos y contador de cuota de YouTube.</summary>
public sealed class ActivityRepository(DbExecuter db)
{
    public Task<IReadOnlyList<NotificationItem>> Notifications(int top, CancellationToken cancellationToken) =>
        db.Query<NotificationItem>("USP_NOTIFICATION_LIST", new { Top = top }, cancellationToken);

    public Task NotificationsRead(CancellationToken cancellationToken) =>
        db.Execute("USP_NOTIFICATION_READ", null, cancellationToken);

    /// <summary>Borra el historial de publicaciones cerradas anterior a <paramref name="before"/>. Devuelve cuántos.</summary>
    public Task<int> EventsPurge(DateTime before, CancellationToken cancellationToken) =>
        db.Single<int>("USP_BG_EVENT_PURGE", new { Before = before }, cancellationToken);

    /// <summary>connectionId = canal que gastó la cuota (0 si todavía no hay fila, al conectar).</summary>
    public Task QuotaAdd(string bucket, int units, int connectionId, CancellationToken cancellationToken) =>
        db.Execute("USP_BG_QUOTA_ADD", new { DayPt = TimeClock.PacificToday, Bucket = bucket, Units = units, ConnectionId = connectionId }, cancellationToken);

    /// <summary>Total del proyecto por bucket y desglose por canal.</summary>
    public Task<(IReadOnlyList<InsightsDay> Daily, IReadOnlyList<InsightsAccount> Accounts)> Insights(DateTime from, CancellationToken cancellationToken) =>
        db.Multiple<InsightsDay, InsightsAccount>("USP_INSIGHTS", new { From = from }, cancellationToken);

    public async Task<QueueHealth> Health(CancellationToken cancellationToken) =>
        await db.Single<QueueHealth>("USP_SYSTEM_HEALTH", new { CurrentDate = TimeClock.UtcNow }, cancellationToken) ?? new QueueHealth();

    public Task<IReadOnlyList<MetricsDueItem>> MetricsDue(int top, CancellationToken cancellationToken) =>
        db.Query<MetricsDueItem>("USP_BG_METRICS_DUE_LIST", new { Top = top, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task MetricsSave(long publicationId, PublicationMetrics metrics, CancellationToken cancellationToken) =>
        db.Execute("USP_BG_METRICS_SAVE", new { PublicationId = publicationId, metrics.Views, metrics.Likes, metrics.Comments, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task<(IReadOnlyList<QuotaRow> Totals, IReadOnlyList<QuotaChannelRow> Channels)> Quota(CancellationToken cancellationToken) =>
        db.Multiple<QuotaRow, QuotaChannelRow>("USP_QUOTA_GET", new { DayPt = TimeClock.PacificToday }, cancellationToken);
}
