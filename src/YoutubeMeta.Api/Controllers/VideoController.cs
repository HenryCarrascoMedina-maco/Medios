using Microsoft.AspNetCore.Authorization;
using YoutubeMeta.Api.Application.Services;

namespace YoutubeMeta.Api.Controllers;

[Route("api/[controller]")]
[Authorize]
public class VideoController(
        VideoService videoService,
        LibraryService libraryService,
        VideoUploadService uploadService,
        ITusProtocol tusProtocol,
        ExceptionHelper exception,
        ILogger<VideoController> logger
    ) : CustomControllerBase
{
    #region BIBLIOTECA
    [HttpGet]
    public Task<IActionResult> List([FromQuery] VideoListQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await videoService.List(query, cancellationToken), ResponseMessage.Listed));

    /// <summary>Biblioteca paginada con filtros: { items, total }.</summary>
    [HttpGet("Page")]
    public Task<IActionResult> Page([FromQuery] VideoListQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await libraryService.Page(query, cancellationToken), ResponseMessage.Listed));

    [HttpGet("Tags")]
    public Task<IActionResult> Tags(CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await libraryService.Tags(cancellationToken), ResponseMessage.Listed));

    [HttpPost("Tags")]
    public Task<IActionResult> SetTags([FromBody] VideoTagsRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await libraryService.SetTags(request, cancellationToken), ResponseMessage.Updated));

    [HttpPost("DeleteMany")]
    public Task<IActionResult> DeleteMany([FromBody] VideoIdsRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await libraryService.DeleteMany(request, GetUserName, cancellationToken), ResponseMessage.Deleted));

    /// <summary>Miniatura nueva (multipart, campo «file», JPEG de hasta 2 MB).</summary>
    [HttpPost("{id:int}/Poster")]
    [RequestSizeLimit(3 * 1024 * 1024)]
    public Task<IActionResult> ReplacePoster(int id, IFormFile? file, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await libraryService.ReplacePoster(id, file, GetUserName, cancellationToken), ResponseMessage.Updated));

    [HttpGet("{id:int}")]
    public Task<IActionResult> Get(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await videoService.Get(id, cancellationToken), ResponseMessage.Found));

    [HttpPut("{id:int}/Title")]
    public Task<IActionResult> UpdateTitle(int id, [FromBody] VideoTitleRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await videoService.UpdateTitle(id, request, GetUserName, cancellationToken), ResponseMessage.Updated));

    [HttpDelete("{id:int}")]
    public Task<IActionResult> Delete(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await videoService.Delete(id, GetUserName, cancellationToken), ResponseMessage.Deleted));

    [HttpGet("{id:int}/Poster")]
    [ResponseCache(Duration = 86400, Location = ResponseCacheLocation.Client)]
    public Task<IActionResult> Poster(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () =>
        {
            var video = await videoService.GetFile(id, cancellationToken);
            if (video == null) return NotFound(ResponseMessage.NotFound);

            // Una imagen sin miniatura propia es su propia miniatura.
            (string? relative, string type) = video.PosterPath != null ? (video.PosterPath, "image/jpeg")
                : video.MediaKind == MediaKinds.Image ? (video.StoragePath, video.ContentType) : (null, "");
            if (relative == null) return NotFound(ResponseMessage.NotFound);

            string path = videoService.ResolvePath(relative);
            return System.IO.File.Exists(path) ? PhysicalFile(path, type) : NotFound(ResponseMessage.NotFound);
        });

    [HttpPost("Poster")]
    [RequestSizeLimit(3 * 1024 * 1024)]
    public Task<IActionResult> UploadPoster(IFormFile file, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await uploadService.StorePosterAsync(file, cancellationToken), ResponseMessage.Created));
    #endregion

    #region STREAMING POR PARTES
    [HttpPost("{id:int}/stream-ticket")]
    public Task<IActionResult> StreamTicket(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await videoService.IssueStreamTicket(id, cancellationToken), ResponseMessage.Found));

    /// <summary>
    /// Sirve el video por pedazos (206). Un rango abierto ("bytes=0-", lo que pide siempre el &lt;video&gt;) se
    /// recorta a Storage:StreamChunkMb: el navegador pide el siguiente pedazo a medida que reproduce o salta.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("stream/t/{ticket}")]
    public async Task<IActionResult> StreamByTicket(string ticket, CancellationToken cancellationToken)
    {
        int? videoId = videoService.RedeemStreamTicket(ticket);
        if (videoId == null) return StatusCode(StatusCodes.Status410Gone, "La vista previa venció. Vuelve a abrir el video.");

        var video = await videoService.GetFile(videoId.Value, cancellationToken);
        if (video == null) return NotFound(ResponseMessage.NotFound);

        string path = videoService.ResolvePath(video.StoragePath);
        if (!System.IO.File.Exists(path)) return NotFound("El archivo ya no está disponible en el servidor.");

        long fileSize = new FileInfo(path).Length;
        string rangeHeader = Request.Headers.Range.ToString();
        int chunk = videoService.StreamChunkBytes;

        long start = 0, end = fileSize - 1;
        bool partial = false;
        if (!string.IsNullOrWhiteSpace(rangeHeader))
        {
            if (!FileRangeHelper.TryParseVideoChunkedRange(rangeHeader, fileSize, chunk, out start, out end))
            {
                Response.Headers.ContentRange = $"bytes */{fileSize}";
                return StatusCode(StatusCodes.Status416RangeNotSatisfiable);
            }
            partial = true;
        }
        else if (fileSize > chunk)
        {
            end = chunk - 1;
            partial = true;
        }

        long length = end - start + 1;
        Response.StatusCode = partial ? StatusCodes.Status206PartialContent : StatusCodes.Status200OK;
        Response.ContentType = video.ContentType;
        Response.ContentLength = length;
        Response.Headers.AcceptRanges = "bytes";
        Response.Headers.CacheControl = "private, max-age=3600";
        if (partial) Response.Headers.ContentRange = $"bytes {start}-{end}/{fileSize}";

        try
        {
            await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16, FileOptions.Asynchronous);
            stream.Seek(start, SeekOrigin.Begin);
            await CopyRangeAsync(stream, Response.Body, length, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // El reproductor cancela peticiones al saltar en la línea de tiempo: es normal.
        }
        catch (IOException ex)
        {
            logger.LogDebug(ex, "Streaming del video {VideoId} interrumpido.", videoId);
        }

        return new EmptyResult();
    }

    private static async Task CopyRangeAsync(Stream source, Stream target, long length, CancellationToken cancellationToken)
    {
        byte[] buffer = System.Buffers.ArrayPool<byte>.Shared.Rent(1 << 16);
        try
        {
            long remaining = length;
            while (remaining > 0)
            {
                int read = await source.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, remaining)), cancellationToken);
                if (read == 0) break;
                await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                remaining -= read;
            }
        }
        finally
        {
            System.Buffers.ArrayPool<byte>.Shared.Return(buffer);
        }
    }
    #endregion

    #region TUS RESUMABLE UPLOAD ENDPOINTS
    [AllowAnonymous]
    [HttpOptions("tus")]
    [HttpOptions("tus/{uploadId}")]
    public IActionResult TusOptions()
    {
        tusProtocol.AddTusHeaders();
        Response.Headers["Tus-Max-Size"] = uploadService.Config.MaxUploadBytes.ToString();
        return NoContent();
    }

    [HttpGet("tus/config")]
    public IActionResult TusConfig() =>
        Ok(new CustomGenericResponse<TusConfigResponse> { IsSuccess = true, Data = uploadService.Config });

    [HttpPost("tus")]
    public Task<IActionResult> CreateTusUpload(CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () =>
        {
            if (TusVersionError() is { } invalid) return invalid;

            if (!long.TryParse(Request.Headers["Upload-Length"], out long uploadLength) || uploadLength <= 0)
                return BadRequest("El header Upload-Length es requerido y debe ser mayor a 0.");

            string uploadId = VideoUploadService.NewUploadId();
            var result = await uploadService.InitializeAsync(uploadId, Request.Headers["Upload-Metadata"].ToString(), uploadLength, GetUserName, cancellationToken);
            if (!result.IsSuccess) return BadRequest(result.Errors[0]);

            tusProtocol.AddTusHeaders();
            Response.Headers.Location = tusProtocol.BuildTusLocation(uploadId);
            Response.Headers["Upload-Offset"] = "0";
            Response.Headers["Upload-Length"] = uploadLength.ToString();
            return StatusCode(StatusCodes.Status201Created);
        });

    [HttpHead("tus/{uploadId}")]
    public Task<IActionResult> HeadTusUpload(string uploadId, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () =>
        {
            if (TusVersionError() is { } invalid) return invalid;

            var result = await uploadService.GetOffsetAsync(uploadId, cancellationToken);
            tusProtocol.AddTusHeaders();
            if (!result.IsSuccess) return TusError(result.Errors[0]);

            Response.Headers.CacheControl = "no-store";
            Response.Headers["Upload-Offset"] = result.Data.Offset.ToString();
            Response.Headers["Upload-Length"] = result.Data.Metadata.UploadLength.ToString();
            return NoContent();
        });

    [HttpPatch("tus/{uploadId}")]
    [RequestSizeLimit(64 * 1024 * 1024)]
    public Task<IActionResult> PatchTusUpload(string uploadId, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () =>
        {
            if (TusVersionError() is { } invalid) return invalid;

            if (!long.TryParse(Request.Headers["Upload-Offset"], out long requestedOffset) || requestedOffset < 0)
                return BadRequest("El header Upload-Offset es requerido.");
            if (Request.ContentLength is null or <= 0)
                return BadRequest("El cuerpo de la petición no contiene datos para anexar.");
            if (!string.Equals(Request.ContentType, "application/offset+octet-stream", StringComparison.OrdinalIgnoreCase))
                return StatusCode(StatusCodes.Status415UnsupportedMediaType, "Content-Type debe ser application/offset+octet-stream.");

            var result = await uploadService.AppendAsync(uploadId, Request.Body, requestedOffset, cancellationToken);
            tusProtocol.AddTusHeaders();

            if (!result.IsSuccess)
            {
                string error = result.Errors[0];
                if (!error.StartsWith(VideoUploadService.ConflictPrefix, StringComparison.Ordinal))
                    return TusError(error);

                Response.Headers["Upload-Offset"] = ExtractCurrentOffset(error);
                return StatusCode(StatusCodes.Status409Conflict, error);
            }

            Response.Headers["Upload-Offset"] = result.Data.ToString();
            return NoContent();
        });

    [HttpDelete("tus/{uploadId}")]
    public Task<IActionResult> DeleteTusUpload(string uploadId, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () =>
        {
            if (TusVersionError() is { } invalid) return invalid;

            var result = await uploadService.DeleteAsync(uploadId, cancellationToken);
            tusProtocol.AddTusHeaders();
            return result.IsSuccess ? NoContent() : NotFound(result.Errors[0]);
        });

    private IActionResult? TusVersionError()
    {
        var version = tusProtocol.ValidateTusVersion();
        return version.IsValid ? null : StatusCode(StatusCodes.Status412PreconditionFailed, version.ErrorMessage);
    }

    /// <summary>
    /// 404 = la sesión no existe o caducó (el cliente empieza de cero); 503 = falló la finalización
    /// (el cliente reintenta y la finalización se repite); 400 = petición inválida.
    /// </summary>
    private IActionResult TusError(string error)
    {
        if (error == VideoUploadService.NotFoundMessage) return NotFound(error);
        if (error.StartsWith(VideoUploadService.FinalizePrefix, StringComparison.Ordinal))
            return StatusCode(StatusCodes.Status503ServiceUnavailable, error[(VideoUploadService.FinalizePrefix.Length + 2)..]);
        return BadRequest(error);
    }

    private static string ExtractCurrentOffset(string errorMessage)
    {
        const string marker = "actual es ";
        int index = errorMessage.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (index < 0) return "0";

        string value = errorMessage[(index + marker.Length)..];
        int space = value.IndexOf(' ');
        return space > 0 ? value[..space] : value;
    }
    #endregion
}
