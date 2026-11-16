using Microsoft.AspNetCore.Authorization;
using YoutubeMeta.Api.Application.Inbox;

namespace YoutubeMeta.Api.Controllers;

/// <summary>Bandeja unificada: conversaciones, mensajes, contactos y Configuración › Bandeja (las respuestas con /atajo son plantillas: TemplateController).</summary>
[Route("api/[controller]")]
[Authorize]
public class InboxController(InboxService inboxService, ExceptionHelper exception) : CustomControllerBase
{
    #region CONVERSACIONES
    [HttpGet("Conversations")]
    public Task<IActionResult> Conversations([FromQuery] InboxConversationQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.Conversations(query, cancellationToken), ResponseMessage.Listed));

    [HttpGet("Conversations/{id:long}")]
    public Task<IActionResult> Conversation(long id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.Conversation(id, cancellationToken), ResponseMessage.Found));

    [HttpPatch("Conversations/{id:long}")]
    public Task<IActionResult> Update(long id, [FromBody] InboxConversationUpdateRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.Update(id, request, cancellationToken), ResponseMessage.Updated));

    [HttpGet("Counts")]
    public Task<IActionResult> Counts(CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.Counts(cancellationToken), ResponseMessage.Found));

    [HttpGet("Conversations/{id:long}/Messages")]
    public Task<IActionResult> Messages(long id, [FromQuery] InboxMessageQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.Messages(id, query, cancellationToken), ResponseMessage.Listed));

    [HttpPost("Conversations/{id:long}/Messages")]
    public Task<IActionResult> Send(long id, [FromBody] InboxReplyRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.Reply(id, request, GetUserName, cancellationToken), ResponseMessage.Created));

    [HttpPost("Conversations/Start")]
    public Task<IActionResult> Start([FromBody] ConversationStartRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.ConversationStart(request, GetUserName, cancellationToken), ResponseMessage.Created));

    [HttpPost("Invites")]
    public Task<IActionResult> InviteCreate([FromBody] InviteCreateRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.InviteCreate(request, GetUserName, cancellationToken), ResponseMessage.Created));
    #endregion

    #region MENSAJES
    [HttpPost("Messages/{id:long}/Resolve")]
    public Task<IActionResult> Resolve(long id, [FromBody] InboxMessageResolveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.Resolve(id, request, cancellationToken), ResponseMessage.Updated));

    [HttpGet("Messages/{id:long}/Attachments/{index:int}")]
    public async Task<IActionResult> Attachment(long id, int index, CancellationToken cancellationToken) =>
        await inboxService.Attachment(id, index, cancellationToken) is { } file
            ? File(file.Content, file.ContentType, file.FileName)
            : NotFound("El archivo ya no está disponible en la plataforma.");
    #endregion

    #region CONTACTOS
    [HttpGet("Contacts")]
    public Task<IActionResult> Contacts([FromQuery] ContactSearchQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.ContactSearch(query, cancellationToken), ResponseMessage.Listed));

    [HttpGet("Contacts/{id:int}")]
    public Task<IActionResult> Contact(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.Contact(id, cancellationToken), ResponseMessage.Found));

    [HttpPost("Contacts")]
    public Task<IActionResult> ContactCreate([FromBody] ContactCreateRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.ContactCreate(request, GetUserName, cancellationToken), ResponseMessage.Created));

    [HttpPut("Contacts/{id:int}/Link")]
    public Task<IActionResult> ContactLink(int id, [FromBody] ContactLinkRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.ContactLink(id, request, cancellationToken), ResponseMessage.Updated));
    #endregion

    #region CONFIGURACIÓN
    [HttpGet("Rules")]
    public IActionResult Rules() => Reply(CustomTransactionResponse<Domain.Rules.InboxRulesInfo>.Ok(inboxService.Rules()), ResponseMessage.Found);

    [HttpGet("Settings")]
    public Task<IActionResult> Settings(CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.SettingsGet(cancellationToken), ResponseMessage.Found));

    [HttpPut("Accounts/{id:int}")]
    public Task<IActionResult> AccountSave(int id, [FromBody] InboxAccountSettingsRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.AccountSave(id, request, cancellationToken), ResponseMessage.Updated));

    [HttpGet("Accounts/{id:int}/Templates")]
    public Task<IActionResult> Templates(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.Templates(id, cancellationToken), ResponseMessage.Listed));

    [HttpPost("Accounts/{id:int}/Prepare")]
    public Task<IActionResult> AccountPrepare(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await inboxService.AccountPrepare(id, cancellationToken), ResponseMessage.Updated));
    #endregion
}
