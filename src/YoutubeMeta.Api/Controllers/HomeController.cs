using Microsoft.AspNetCore.Authorization;
using YoutubeMeta.Api.Application.Services;

namespace YoutubeMeta.Api.Controllers;

/// <summary>Panel principal (Inicio).</summary>
[Route("api/[controller]")]
[Authorize]
public class HomeController(HomeService homeService, ExceptionHelper exception) : CustomControllerBase
{
    [HttpGet("Summary")]
    public Task<IActionResult> Summary([FromQuery] HomeQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await homeService.Summary(query, cancellationToken), ResponseMessage.Found));
}
