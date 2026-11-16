using Microsoft.AspNetCore.Authorization;
using YoutubeMeta.Api.Application.Services;

namespace YoutubeMeta.Api.Controllers;

[Route("api/[controller]")]
[Authorize]
public class PublicationController(PublicationService publicationService, ExceptionHelper exception) : CustomControllerBase
{
    [HttpGet("Rules")]
    public IActionResult Rules() => Reply(CustomTransactionResponse<Domain.Rules.PublicationRulesInfo>.Ok(publicationService.Rules()), ResponseMessage.Found);

    [HttpPost("{id:long}/Comment")]
    public Task<IActionResult> RetryComment(long id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await publicationService.RetryComment(id, cancellationToken), ResponseMessage.Updated));

    [HttpGet("Calendar")]
    public Task<IActionResult> Calendar([FromQuery] CalendarQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await publicationService.Calendar(query, cancellationToken), ResponseMessage.Listed));

    [HttpPost("{id:long}/Reschedule")]
    public Task<IActionResult> Reschedule(long id, [FromBody] RescheduleRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await publicationService.Reschedule(id, request, GetUserName, cancellationToken), ResponseMessage.Updated));

    /// <summary>CSV con los mismos filtros que el listado (sin el tope de 300).</summary>
    [HttpGet("Export")]
    public Task<IActionResult> Export([FromQuery] PublicationListQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () =>
            File(await publicationService.ExportCsv(query, cancellationToken), "text/csv; charset=utf-8", $"publicaciones-{TimeClock.UtcNow:yyyyMMdd-HHmm}.csv"));

    [HttpGet]
    public Task<IActionResult> List([FromQuery] PublicationListQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await publicationService.List(query, cancellationToken), ResponseMessage.Listed));

    [HttpGet("Events")]
    public Task<IActionResult> Events([FromQuery] int videoId, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await publicationService.Events(videoId, cancellationToken), ResponseMessage.Listed));

    [HttpPost]
    public Task<IActionResult> Create([FromBody] PublicationCreateRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await publicationService.Create(request, GetUserName, cancellationToken), ResponseMessage.Created));

    [HttpPost("{id:long}/Retry")]
    public Task<IActionResult> Retry(long id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await publicationService.Retry(id, GetUserName, cancellationToken), ResponseMessage.Updated));

    [HttpPost("{id:long}/Cancel")]
    public Task<IActionResult> Cancel(long id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await publicationService.Cancel(id, GetUserName, cancellationToken), ResponseMessage.Updated));

    /// <summary>Resolver a mano: { action: "MARK_DONE" | "REUPLOAD", externalUrl? }.</summary>
    [HttpPost("{id:long}/Resolve")]
    public Task<IActionResult> Resolve(long id, [FromBody] PublicationResolveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await publicationService.Resolve(id, request, GetUserName, cancellationToken), ResponseMessage.Updated));

    [HttpGet("Notifications")]
    public Task<IActionResult> Notifications(CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await publicationService.Notifications(cancellationToken), ResponseMessage.Listed));

    [HttpPost("Notifications/Read")]
    public Task<IActionResult> NotificationsRead(CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await publicationService.NotificationsRead(cancellationToken), ResponseMessage.Updated));
}
