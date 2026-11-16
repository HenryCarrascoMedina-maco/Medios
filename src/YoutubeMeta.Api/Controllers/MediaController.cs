using Microsoft.AspNetCore.Authorization;
using YoutubeMeta.Api.Application.Services;
using YoutubeMeta.Api.Common.Security;

namespace YoutubeMeta.Api.Controllers;

/// <summary>
/// Archivos de la biblioteca servidos a las plataformas que los descargan (Instagram y TikTok). Anónimo: lo protege
/// el enlace firmado de <see cref="MediaLinks"/>, que solo vale para un archivo y caduca.
/// </summary>
[Route("api/[controller]")]
public class MediaController(VideoService videoService, MediaLinks links) : CustomControllerBase
{
    [AllowAnonymous]
    [HttpGet("Public/{token}")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> Public(string token, CancellationToken cancellationToken)
    {
        if (links.Read(token) is not { } mediaId) return StatusCode(StatusCodes.Status410Gone);

        var media = await videoService.GetFile(mediaId, cancellationToken);
        if (media == null) return NotFound();

        string path = videoService.ResolvePath(media.StoragePath);
        return System.IO.File.Exists(path) ? PhysicalFile(path, media.ContentType, enableRangeProcessing: true) : NotFound();
    }
}
