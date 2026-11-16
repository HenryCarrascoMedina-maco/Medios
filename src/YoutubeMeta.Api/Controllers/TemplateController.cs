using Microsoft.AspNetCore.Authorization;
using YoutubeMeta.Api.Application.Services;

namespace YoutubeMeta.Api.Controllers;

/// <summary>Plantillas propias de publicación y de respuesta (/api/Template) y bloques de hashtags (/api/Template/Blocks).</summary>
[Route("api/[controller]")]
[Authorize]
public class TemplateController(ContentService contentService, ExceptionHelper exception) : CustomControllerBase
{
    /// <summary>Plantillas con sus adjuntos. ?usage=PUBLISH o REPLY; sin él, todas.</summary>
    [HttpGet]
    public Task<IActionResult> List([FromQuery] string? usage, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await contentService.Templates(usage, cancellationToken), ResponseMessage.Listed));

    [HttpPost]
    public Task<IActionResult> Create([FromBody] TemplateSaveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await contentService.SaveTemplate(null, request, GetUserName, cancellationToken), ResponseMessage.Created));

    [HttpPut("{id:int}")]
    public Task<IActionResult> Update(int id, [FromBody] TemplateSaveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await contentService.SaveTemplate(id, request, GetUserName, cancellationToken), ResponseMessage.Updated));

    [HttpDelete("{id:int}")]
    public Task<IActionResult> Delete(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await contentService.DeleteTemplate(id, cancellationToken), ResponseMessage.Deleted));

    [HttpPost("{id:int}/Used")]
    public Task<IActionResult> Used(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await contentService.TemplateUsed(id, cancellationToken), ResponseMessage.Updated));

    [HttpGet("Blocks")]
    public Task<IActionResult> Blocks(CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await contentService.HashtagBlocks(cancellationToken), ResponseMessage.Listed));

    [HttpPost("Blocks")]
    public Task<IActionResult> CreateBlock([FromBody] HashtagBlockSaveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await contentService.SaveHashtagBlock(null, request, GetUserName, cancellationToken), ResponseMessage.Created));

    [HttpPut("Blocks/{id:int}")]
    public Task<IActionResult> UpdateBlock(int id, [FromBody] HashtagBlockSaveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await contentService.SaveHashtagBlock(id, request, GetUserName, cancellationToken), ResponseMessage.Updated));

    [HttpDelete("Blocks/{id:int}")]
    public Task<IActionResult> DeleteBlock(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await contentService.DeleteHashtagBlock(id, cancellationToken), ResponseMessage.Deleted));
}
