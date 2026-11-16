using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using YoutubeMeta.Api.Application.Services;

namespace YoutubeMeta.Api.Controllers;

[Route("api/[controller]")]
[Authorize]
public class AuthController(AuthService authService, ExceptionHelper exception) : CustomControllerBase
{
    [AllowAnonymous]
    [HttpPost("Login")]
    [EnableRateLimiting(RateLimits.Login)]
    public Task<IActionResult> Login([FromBody] LoginRequest request) =>
        exception.TryCatchActionAsync(async () => Reply(await authService.Login(request, ClientIp), "Sesión iniciada."));

    [HttpPost("Refresh")]
    public IActionResult Refresh() => Reply(authService.Refresh(GetUserId, GetUserName), "Sesión renovada.");

    [HttpGet("Me")]
    public IActionResult Me() =>
        Ok(new CustomGenericResponse<object> { IsSuccess = true, Data = new { id = GetUserId, userName = GetUserName } });

    private string ClientIp => HttpContext.Connection.RemoteIpAddress?.ToString() ?? "desconocida";
}
