using Microsoft.AspNetCore.Authorization;
using YoutubeMeta.Api.Application.Services;

namespace YoutubeMeta.Api.Controllers;

[Route("api/[controller]")]
[Authorize]
public class SettingsController(CredentialService credentialService, ExceptionHelper exception) : CustomControllerBase
{
    [HttpGet("Platforms")]
    public Task<IActionResult> Platforms(CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await credentialService.Get(cancellationToken), ResponseMessage.Found));

    [HttpPost("Platforms")]
    public Task<IActionResult> Save([FromBody] CredentialSaveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await credentialService.Save(request, GetUserName, cancellationToken), ResponseMessage.Updated));

    [HttpDelete("Platforms/{id:int}")]
    public Task<IActionResult> Delete(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await credentialService.Delete(id, GetUserName, cancellationToken), ResponseMessage.Deleted));
}
