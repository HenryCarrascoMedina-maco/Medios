using YoutubeMeta.Api.Infrastructure.Data;

namespace YoutubeMeta.Api.Infrastructure.Repositories;

public sealed class VideoRepository(DbExecuter db)
{
    public Task<int> Create(VideoRow video, TusVideoMetadata metadata, CancellationToken cancellationToken) =>
        db.Single<int>("USP_VIDEO_CREATE", new
        {
            video.Title,
            video.OriginalFileName,
            video.StoragePath,
            video.PosterPath,
            video.ContentType,
            video.SizeBytes,
            metadata.DurationSec,
            metadata.Width,
            metadata.Height,
            video.MediaKind,
            metadata.UserName,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    public Task<IReadOnlyList<VideoItem>> List(string? searchTerm, CancellationToken cancellationToken) =>
        db.Query<VideoItem>("USP_VIDEO_LIST", new { SearchTerm = searchTerm }, cancellationToken);

    /// <summary>Página filtrada de la biblioteca (TotalCount de cada fila = total sin paginar).</summary>
    public Task<IReadOnlyList<VideoItem>> Page(VideoListQuery q, CancellationToken cancellationToken) =>
        db.Query<VideoItem>("USP_VIDEO_LIST", new
        {
            SearchTerm = string.IsNullOrWhiteSpace(q.SearchTerm) ? null : q.SearchTerm.Trim(),
            Status = string.IsNullOrWhiteSpace(q.Status) ? null : q.Status.ToUpperInvariant(),
            Platform = Platforms.IsValid(q.Platform) ? q.Platform : null,
            Tag = string.IsNullOrWhiteSpace(q.Tag) ? null : q.Tag,
            Kind = MediaKinds.IsValid(q.Kind) ? q.Kind : null,
            Sort = string.IsNullOrWhiteSpace(q.Sort) ? null : q.Sort.ToUpperInvariant(),
            Offset = Math.Max(q.Offset, 0),
            q.Take,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    public Task<IReadOnlyList<TagItem>> Tags(CancellationToken cancellationToken) =>
        db.Query<TagItem>("USP_TAG_LIST", null, cancellationToken);

    public Task<int> TagsSet(IEnumerable<int> videoIds, IEnumerable<string> add, IEnumerable<string> remove, CancellationToken cancellationToken) =>
        db.Single<int>("USP_VIDEO_TAGS_SET", new
        {
            VideoIds = System.Text.Json.JsonSerializer.Serialize(videoIds),
            Add = System.Text.Json.JsonSerializer.Serialize(add),
            Remove = System.Text.Json.JsonSerializer.Serialize(remove)
        }, cancellationToken);

    /// <summary>Cambia la miniatura y devuelve la ruta de la anterior (para borrar el archivo).</summary>
    public Task<string?> PosterSave(int id, string posterPath, string userName, CancellationToken cancellationToken) =>
        db.Single<string?>("USP_VIDEO_POSTER_SAVE", new { Id = id, PosterPath = posterPath, UserName = userName, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task<VideoItem?> Get(int id, CancellationToken cancellationToken) =>
        db.Single<VideoItem>("USP_VIDEO_LIST", new { Id = id }, cancellationToken);

    public Task<VideoRow?> GetFile(int id, CancellationToken cancellationToken) =>
        db.Single<VideoRow>("USP_VIDEO_GET", new { Id = id }, cancellationToken);

    public Task UpdateTitle(int id, string title, string userName, CancellationToken cancellationToken) =>
        db.Execute("USP_VIDEO_UPDATE", new { Id = id, Title = title, UserName = userName, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    /// <summary>Baja lógica; devuelve las rutas para borrar los archivos.</summary>
    public Task<VideoRow?> Delete(int id, string userName, CancellationToken cancellationToken) =>
        db.Single<VideoRow>("USP_VIDEO_DELETE", new { Id = id, UserName = userName, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task<long> UsedBytes(CancellationToken cancellationToken) =>
        db.Single<long>("USP_VIDEO_STORAGE_USED", null, cancellationToken);
}
