using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.Repositories;
using YoutubeMeta.Api.Infrastructure.Storage;

namespace YoutubeMeta.Api.Application.Services;

/// <summary>Biblioteca a escala: página con filtros, etiquetas, acciones en lote y miniatura propia.</summary>
public sealed class LibraryService(
        VideoRepository videos,
        VideoService videoService,
        VideoStorage storage,
        ExceptionHelper exception)
{
    public const int PageMax = 200;
    public const int BulkMax = 500;

    public Task<CustomTransactionResponse<VideoPage>> Page(VideoListQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<VideoPage>>(async () =>
        {
            query.Take = Math.Clamp(query.Take ?? 48, 1, PageMax);
            var items = await videos.Page(query, cancellationToken);
            return CustomTransactionResponse<VideoPage>.Ok(new VideoPage { Items = items, Total = items.FirstOrDefault()?.TotalCount ?? 0 });
        });

    public Task<CustomTransactionResponse<IReadOnlyList<TagItem>>> Tags(CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<IReadOnlyList<TagItem>>>(async () =>
            CustomTransactionResponse<IReadOnlyList<TagItem>>.Ok(await videos.Tags(cancellationToken)));

    public Task<CustomTransactionResponse<int>> SetTags(VideoTagsRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<int>>(async () =>
        {
            var ids = request.VideoIds.Distinct().ToList();
            if (BulkError(ids) is { } error) return CustomTransactionResponse<int>.Fail(error);

            var add = ContentRules.NormalizeTags(request.Add);
            var remove = ContentRules.NormalizeTags(request.Remove);
            if (add.Count == 0 && remove.Count == 0) return CustomTransactionResponse<int>.Fail("Escribe al menos una etiqueta válida (letras, números, - o _).");

            return CustomTransactionResponse<int>.Ok(await videos.TagsSet(ids, add, remove, cancellationToken));
        });

    /// <summary>Borra varios videos; sigue aunque alguno falle y devuelve cuántos y por qué no.</summary>
    public Task<CustomTransactionResponse<BulkResult>> DeleteMany(VideoIdsRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<BulkResult>>(async () =>
        {
            var ids = request.VideoIds.Distinct().ToList();
            if (BulkError(ids) is { } error) return CustomTransactionResponse<BulkResult>.Fail(error);

            var result = new BulkResult();
            foreach (int id in ids)
            {
                var deleted = await videoService.Delete(id, userName, cancellationToken);
                if (deleted.IsSuccess) result.Done++;
                else result.Errors.Add($"#{id}: {deleted.Errors.FirstOrDefault()}");
            }
            return CustomTransactionResponse<BulkResult>.Ok(result);
        });

    /// <summary>Miniatura nueva (JPEG que captura el navegador de un fotograma o sube la persona).</summary>
    public Task<CustomTransactionResponse<VideoItem>> ReplacePoster(int id, IFormFile? file, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<VideoItem>>(async () =>
        {
            if (VideoUploadService.PosterError(file) is { } error) return CustomTransactionResponse<VideoItem>.Fail(error);

            string temp = await VideoUploadService.SaveTempPosterAsync(storage, file!, Guid.NewGuid().ToString("N"), cancellationToken);
            string posterPath = VideoStorage.NewPosterRelativePath();
            storage.MoveInto(temp, posterPath);
            try
            {
                string? old = await videos.PosterSave(id, posterPath, userName, cancellationToken);
                storage.TryDelete(old);
            }
            catch
            {
                storage.TryDelete(posterPath);
                throw;
            }

            return CustomTransactionResponse<VideoItem>.Ok((await videos.Get(id, cancellationToken))!);
        });

    private static string? BulkError(List<int> ids) =>
        ids.Count == 0 ? "Elige al menos un video." : ids.Count > BulkMax ? $"Como mucho {BulkMax} videos a la vez." : null;
}
