using Microsoft.Extensions.Caching.Memory;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;
using YoutubeMeta.Api.Infrastructure.Storage;

#region RESPONSES
using ListResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.VideoItem>>;
using ItemResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Responses.VideoItem>;
using TicketResult = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Responses.TicketResponse>;
#endregion

namespace YoutubeMeta.Api.Application.Services;

public sealed class VideoService(
        VideoRepository videos,
        VideoStorage storage,
        IMemoryCache cache,
        IProgressNotifier notifier,
        IOptions<StorageSettings> settings,
        ExceptionHelper exception)
{
    private const string TicketPrefix = "video:ticket:stream:";
    private const int TitleMax = 200;

    public Task<ListResponse> List(VideoListQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ListResponse>(async () =>
            ListResponse.Ok(await videos.List(string.IsNullOrWhiteSpace(query.SearchTerm) ? null : query.SearchTerm.Trim(), cancellationToken)));

    public Task<ItemResponse> Get(int id, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ItemResponse>(async () =>
        {
            var video = await videos.Get(id, cancellationToken);
            return video == null ? ItemResponse.Fail("El video no existe.") : ItemResponse.Ok(video);
        });

    public Task<ItemResponse> UpdateTitle(int id, VideoTitleRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ItemResponse>(async () =>
        {
            string title = request.Title?.Trim() ?? string.Empty;
            if (title.Length == 0 || title.Length > TitleMax) return ItemResponse.Fail($"El título debe tener entre 1 y {TitleMax} caracteres.");

            await videos.UpdateTitle(id, title, userName, cancellationToken);
            return ItemResponse.Ok((await videos.Get(id, cancellationToken))!);
        });

    public Task<CustomTransactionResponse<bool>> Delete(int id, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<bool>>(async () =>
        {
            var deleted = await videos.Delete(id, userName, cancellationToken);
            if (deleted == null) return CustomTransactionResponse<bool>.Fail("El video no existe.");

            storage.TryDelete(deleted.StoragePath);
            storage.TryDelete(deleted.PosterPath);
            await notifier.NotifyAsync(RealTimeEntities.VideoUpload, new { videoId = id, deleted = true, isFinal = true }, cancellationToken);
            return CustomTransactionResponse<bool>.Ok(true);
        });

    /// <summary>
    /// El &lt;video&gt; del navegador no puede mandar Authorization: se emite un ticket de un solo video que caduca
    /// a los Storage:StreamTicketMinutes y se reutiliza en todas las peticiones Range.
    /// </summary>
    public Task<TicketResult> IssueStreamTicket(int id, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<TicketResult>(async () =>
        {
            if (await videos.GetFile(id, cancellationToken) == null) return TicketResult.Fail("El video no existe.");

            string ticket = Guid.NewGuid().ToString("N");
            cache.Set(TicketPrefix + ticket, id, TimeSpan.FromMinutes(Math.Max(settings.Value.StreamTicketMinutes, 1)));
            return TicketResult.Ok(new TicketResponse { Url = $"api/Video/stream/t/{ticket}" });
        });

    public int? RedeemStreamTicket(string ticket) =>
        ticket is { Length: 32 } && ticket.All(Uri.IsHexDigit) && cache.TryGetValue(TicketPrefix + ticket, out int id) ? id : null;

    public Task<VideoRow?> GetFile(int id, CancellationToken cancellationToken) => videos.GetFile(id, cancellationToken);

    public string ResolvePath(string relativePath) => storage.Resolve(relativePath);

    public int StreamChunkBytes => Math.Max(settings.Value.StreamChunkMb, 1) * 1024 * 1024;
}
