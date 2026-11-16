using Microsoft.AspNetCore.Authorization;
using YoutubeMeta.Api.Application.Inbox;
using YoutubeMeta.Api.Common.Security;

namespace YoutubeMeta.Api.Controllers;

/// <summary>
/// Avisos de las plataformas para la bandeja. Anónimos (la plataforma no inicia sesión): los protege la firma de Meta
/// (X-Hub-Signature-256) o el secreto del bot de Telegram. Se guardan en crudo y se responde enseguida.
/// </summary>
[Route("api/[controller]")]
[AllowAnonymous]
public class WebhookController(InboxWebhookService webhooks) : ControllerBase
{
    /// <summary>Lo más grande que manda Meta en un aviso (con margen).</summary>
    private const int MaxBodyBytes = 1024 * 1024;

    /// <summary>Meta comprueba la URL al configurarla: hay que devolver hub.challenge tal cual.</summary>
    [HttpGet("Meta")]
    public async Task<IActionResult> MetaVerify(
        [FromQuery(Name = "hub.mode")] string? mode,
        [FromQuery(Name = "hub.verify_token")] string? verifyToken,
        [FromQuery(Name = "hub.challenge")] string? challenge,
        CancellationToken cancellationToken) =>
        await webhooks.MetaVerify(mode, verifyToken, challenge, cancellationToken) is { } accepted
            ? Content(accepted, "text/plain")
            : Forbid();

    [HttpPost("Meta")]
    [RequestSizeLimit(MaxBodyBytes)]
    public async Task<IActionResult> Meta(CancellationToken cancellationToken)
    {
        byte[] body = await ReadBodyAsync(cancellationToken);
        return await webhooks.MetaReceive(body, Request.Headers[WebhookSignature.MetaHeader], cancellationToken) ? Ok() : Unauthorized();
    }

    [HttpPost("Telegram/{credentialId:int}")]
    [RequestSizeLimit(MaxBodyBytes)]
    public async Task<IActionResult> Telegram(int credentialId, CancellationToken cancellationToken)
    {
        byte[] body = await ReadBodyAsync(cancellationToken);
        return await webhooks.TelegramReceive(credentialId, Request.Headers[WebhookSignature.TelegramHeader], body, cancellationToken) ? Ok() : Unauthorized();
    }

    /// <summary>El cuerpo exacto (la firma de Meta se calcula sobre los bytes tal cual llegan).</summary>
    private async Task<byte[]> ReadBodyAsync(CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        await Request.Body.CopyToAsync(buffer, cancellationToken);
        return buffer.ToArray();
    }
}
