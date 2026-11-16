using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Infrastructure.Data;

namespace YoutubeMeta.Api.Infrastructure.Repositories;

public sealed class PublicationRepository(DbExecuter db) : IPublicationLease
{
    /// <summary>Cancela lo vivo de plataformas desactivadas. Devuelve cuántas.</summary>
    public Task<int> DisabledCancel(IReadOnlyList<string> platforms, CancellationToken cancellationToken) =>
        db.Single<int>("USP_BG_PUBLICATION_DISABLED_CANCEL", new { Platforms = string.Join(',', platforms), CurrentDate = TimeClock.UtcNow }, cancellationToken);

    /// <summary>El post (tipo, enlace y archivos en orden). Devuelve su Id.</summary>
    public Task<int> PostCreate(string kind, string title, string? linkUrl, IReadOnlyList<PostMediaInput> media, string userName, CancellationToken cancellationToken) =>
        db.Single<int>("USP_POST_CREATE", new
        {
            Kind = kind,
            Title = title,
            LinkUrl = string.IsNullOrWhiteSpace(linkUrl) ? null : linkUrl.Trim(),
            Media = media.Count == 0 ? null : System.Text.Json.JsonSerializer.Serialize(media.Select(m => new { id = m.Id, alt = m.Alt?.Trim() })),
            UserName = userName,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    /// <param name="videoId">Medio principal del post (null en posts de solo texto o enlace).</param>
    public Task<long> Save(int postId, int? videoId, PublicationDestination d, string userName, CancellationToken cancellationToken) =>
        db.Single<long>("USP_PUBLICATION_SAVE", new
        {
            PostId = postId,
            VideoId = videoId,
            d.ConnectionId,
            Title = d.Title.Trim(),
            Description = string.IsNullOrWhiteSpace(d.Description) ? null : d.Description,
            Tags = string.IsNullOrWhiteSpace(d.Tags) ? null : d.Tags.Trim(),
            d.CategoryId,
            PrivacyStatus = d.PrivacyStatus ?? PrivacyStatus.Public,
            d.PublishAt,
            MadeForKids = d.MadeForKids ?? false,
            ContainsSyntheticMedia = d.ContainsSyntheticMedia ?? false,
            d.NotifySubscribers,
            Extra = d.Options?.ToJson(),
            UserName = userName,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    public Task<IReadOnlyList<PublicationItem>> List(PublicationListQuery query, CancellationToken cancellationToken) =>
        db.Query<PublicationItem>("USP_PUBLICATION_LIST", ListParameters(query, 300), cancellationToken);

    /// <summary>Todas las del filtro (sin el tope de 300), para exportar.</summary>
    public Task<IReadOnlyList<PublicationItem>> Export(PublicationListQuery query, CancellationToken cancellationToken) =>
        db.Query<PublicationItem>("USP_PUBLICATION_LIST", ListParameters(query, 100_000), cancellationToken);

    private static object ListParameters(PublicationListQuery query, int top) => new
    {
        query.VideoId,
        query.Group,
        Platform = Platforms.IsValid(query.Platform) ? query.Platform : null,
        query.ConnectionId,
        SearchTerm = string.IsNullOrWhiteSpace(query.SearchTerm) ? null : query.SearchTerm.Trim(),
        query.From,
        query.To,
        Top = top,
        CurrentDate = TimeClock.UtcNow
    };

    public Task<string?> TargetOf(long id, CancellationToken cancellationToken) =>
        db.Single<string?>("USP_PUBLICATION_TARGET", new { Id = id }, cancellationToken);

    public Task<IReadOnlyList<CalendarItem>> Calendar(DateTime from, DateTime to, CancellationToken cancellationToken) =>
        db.Query<CalendarItem>("USP_PUBLICATION_CALENDAR", new { From = from, To = to }, cancellationToken);

    public Task<PublicationResultRow?> Reschedule(long id, DateTimeOffset? publishAt, string userName, CancellationToken cancellationToken) =>
        db.Single<PublicationResultRow>("USP_PUBLICATION_RESCHEDULE", new { Id = id, PublishAt = publishAt, UserName = userName, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task<IReadOnlyList<PublicationEventItem>> Events(int videoId, CancellationToken cancellationToken) =>
        db.Query<PublicationEventItem>("USP_PUBLICATION_EVENT_LIST", new { VideoId = videoId }, cancellationToken);

    public Task<PublicationResultRow?> Retry(long id, string userName, CancellationToken cancellationToken) =>
        db.Single<PublicationResultRow>("USP_PUBLICATION_RETRY", new { Id = id, UserName = userName, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task<PublicationResultRow?> Cancel(long id, string userName, CancellationToken cancellationToken) =>
        db.Single<PublicationResultRow>("USP_PUBLICATION_CANCEL", new { Id = id, UserName = userName, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    /// <summary>Resuelve a mano una publicación en revisión o fallida (ya publicada / volver a subir).</summary>
    public Task<PublicationResultRow?> Resolve(long id, string action, string? externalUrl, string userName, CancellationToken cancellationToken) =>
        db.Single<PublicationResultRow>("USP_PUBLICATION_RESOLVE", new
        {
            Id = id,
            Action = action,
            ExternalUrl = string.IsNullOrWhiteSpace(externalUrl) ? null : externalUrl.Trim(),
            UserName = userName,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    public Task<PublicationCommentRow?> CommentGet(long id, CancellationToken cancellationToken) =>
        db.Single<PublicationCommentRow>("USP_PUBLICATION_COMMENT_GET", new { Id = id }, cancellationToken);

    /// <param name="commentExternalId">null = no se pudo poner (queda el aviso con <paramref name="message"/>).</param>
    public Task<PublicationResultRow?> CommentSave(long id, string? commentExternalId, string message, CancellationToken cancellationToken) =>
        db.Single<PublicationResultRow>("USP_PUBLICATION_COMMENT_SAVE", new
        {
            Id = id,
            CommentExternalId = commentExternalId,
            Message = message,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    #region JOB
    public Task<IReadOnlyList<PublicationDueItem>> DueList(string target, int top, string leaseOwner, int leaseMinutes, CancellationToken cancellationToken) =>
        db.Query<PublicationDueItem>("USP_BG_PUBLICATION_DUE_LIST", new
        {
            Target = target,
            Top = top,
            LeaseOwner = leaseOwner,
            LeaseMinutes = leaseMinutes,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    public Task<IReadOnlyList<PublicationPollItem>> PollDueList(int top, string leaseOwner, int leaseMinutes, CancellationToken cancellationToken) =>
        db.Query<PublicationPollItem>("USP_BG_PUBLICATION_POLL_DUE_LIST", new
        {
            Top = top,
            LeaseOwner = leaseOwner,
            LeaseMinutes = leaseMinutes,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    /// <summary>Renueva el lease y guarda el avance. 0 = otro proceso tomó la fila.</summary>
    public Task<int> LeaseExtend(long id, string leaseOwner, int leaseMinutes, long bytesSent, long totalBytes, int percent, CancellationToken cancellationToken) =>
        db.Single<int>("USP_BG_PUBLICATION_LEASE_EXTEND", new
        {
            Id = id,
            LeaseOwner = leaseOwner,
            LeaseMinutes = leaseMinutes,
            BytesSent = bytesSent,
            TotalBytes = totalBytes,
            Percent = percent,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    public Task<int> CommitMark(long id, string leaseOwner, CancellationToken cancellationToken) =>
        db.Single<int>("USP_BG_PUBLICATION_COMMIT_MARK", new { Id = id, LeaseOwner = leaseOwner, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task<int> SessionSave(long id, string leaseOwner, string? sessionData, CancellationToken cancellationToken) =>
        db.Single<int>("USP_BG_PUBLICATION_SESSION_SAVE", new
        {
            Id = id,
            LeaseOwner = leaseOwner,
            SessionData = sessionData,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    public Task<PublicationResultRow?> Result(long id, string leaseOwner, PublicationResult result, CancellationToken cancellationToken) =>
        db.Single<PublicationResultRow>("USP_BG_PUBLICATION_RESULT", new
        {
            Id = id,
            LeaseOwner = leaseOwner,
            result.StatusCode,
            result.ExternalId,
            result.ExternalUrl,
            result.CommentExternalId,
            result.Warning,
            result.ErrorCode,
            result.ErrorMessage,
            result.NextAttemptAt,
            result.ClearSession,
            result.ClearExternal,
            result.IsPoll,
            result.EventMessage,
            result.IsNotification,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);
    #endregion
}

/// <summary>Cierre de un intento del job; lo traduce PublicationProcessor desde un PublishStep.</summary>
public sealed record PublicationResult(
    string StatusCode,
    string? ExternalId = null,
    string? ExternalUrl = null,
    string? Warning = null,
    string? ErrorCode = null,
    string? ErrorMessage = null,
    DateTime? NextAttemptAt = null,
    bool ClearSession = false,
    bool ClearExternal = false,
    bool IsPoll = false,
    string? EventMessage = null,
    bool IsNotification = false,
    string? CommentExternalId = null);
