using Microsoft.AspNetCore.Authorization;
using YoutubeMeta.Api.Application.Services;

namespace YoutubeMeta.Api.Controllers;

/// <summary>Resultados (/api/Insights?days=30) y salud del sistema con alertas (/api/Insights/Health).</summary>
[Route("api/[controller]")]
[Authorize]
public class InsightsController(InsightsService insightsService, ExceptionHelper exception) : CustomControllerBase
{
    [HttpGet]
    public Task<IActionResult> Insights([FromQuery] InsightsQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await insightsService.Insights(query, cancellationToken), ResponseMessage.Found));

    [HttpGet("Health")]
    public Task<IActionResult> Health(CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await insightsService.Health(cancellationToken), ResponseMessage.Found));
}
