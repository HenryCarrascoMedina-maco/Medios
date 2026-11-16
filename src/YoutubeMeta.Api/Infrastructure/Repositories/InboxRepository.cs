using YoutubeMeta.Api.Infrastructure.Data;

namespace YoutubeMeta.Api.Infrastructure.Repositories;

/// <summary>Bandeja: avisos en crudo, conversaciones, mensajes (y su cola de envío) y contactos.</summary>
public sealed class InboxRepository(DbExecuter db)
{
    #region AVISOS (webhooks y consultas)
    /// <summary>true si es nuevo; false si la plataforma reintentó un aviso ya guardado.</summary>
    public Task<bool> EventSave(string platform, string eventKey, string payload, CancellationToken cancellationToken) =>
        db.Single<bool>("USP_INBOX_EVENT_SAVE", new { Platform = platform, EventKey = eventKey, Payload = payload, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task<IReadOnlyList<string>> EventsRecent(string platform, string keyPrefix, DateTime since, CancellationToken cancellationToken) =>
        db.Query<string>("USP_INBOX_EVENT_RECENT", new { Platform = platform, KeyPrefix = keyPrefix, Since = since }, cancellationToken);

    public Task<IReadOnlyList<InboxEventRow>> EventsDue(int top, string leaseOwner, int leaseMinutes, int maxAttempts, CancellationToken cancellationToken) =>
        db.Query<InboxEventRow>("USP_BG_INBOX_EVENT_DUE_LIST",
            new { Top = top, LeaseOwner = leaseOwner, LeaseMinutes = leaseMinutes, MaxAttempts = maxAttempts, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task EventResult(long id, string leaseOwner, string status, string? error, DateTime? nextAttemptAt, CancellationToken cancellationToken) =>
        db.Execute("USP_BG_INBOX_EVENT_RESULT",
            new { Id = id, LeaseOwner = leaseOwner, StatusCode = status, ErrorMessage = error, NextAttemptAt = nextAttemptAt, CurrentDate = TimeClock.UtcNow }, cancellationToken);
    #endregion

    #region ENTRADA NORMALIZADA
    public Task<InboxIngestResult?> Ingest(InboxIncoming message, CancellationToken cancellationToken) =>
        db.Single<InboxIngestResult>("USP_BG_INBOX_INGEST", new
        {
            message.ConnectionId,
            message.Kind,
            message.ConversationExternalId,
            message.Title,
            message.Link,
            message.PublicationExternalId,
            ContactExternalId = message.Contact?.ExternalId,
            ContactName = message.Contact?.Name,
            ContactHandle = message.Contact?.Handle,
            ContactAvatarUrl = message.Contact?.AvatarUrl,
            message.MessageExternalId,
            message.ParentExternalId,
            message.Direction,
            message.AuthorName,
            message.AuthorExternalId,
            message.Body,
            Attachments = InboxAttachment.ToJson(message.Attachments),
            message.SentAt,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    /// <summary>Acuse de entrega / lectura / fallo. Devuelve la conversación si cambió algo.</summary>
    public Task<long?> StatusSave(string platform, string externalId, string status, string? error, CancellationToken cancellationToken) =>
        db.Single<long?>("USP_BG_INBOX_STATUS_SAVE",
            new { Platform = platform, ExternalId = externalId, StatusCode = status, ErrorMessage = error, CurrentDate = TimeClock.UtcNow }, cancellationToken);
    #endregion

    #region CONVERSACIONES Y MENSAJES
    public Task<IReadOnlyList<InboxConversationItem>> Conversations(InboxConversationQuery query, CancellationToken cancellationToken) =>
        db.Query<InboxConversationItem>("USP_INBOX_CONVERSATION_LIST", new
        {
            StatusCode = InboxConversationStatus.IsValid(query.Status) ? query.Status : null,
            Platform = Platforms.IsConnectable(query.Platform) ? query.Platform : null,
            Kind = InboxKinds.IsValid(query.Kind) ? query.Kind : null,
            query.ConnectionId,
            UnreadOnly = query.Unread,
            AwaitingOnly = query.Awaiting,
            Tag = string.IsNullOrWhiteSpace(query.Tag) ? null : query.Tag.Trim(),
            SearchTerm = string.IsNullOrWhiteSpace(query.SearchTerm) ? null : query.SearchTerm.Trim(),
            query.BeforeAt,
            query.BeforeId,
            Take = Math.Clamp(query.Take, 1, 100)
        }, cancellationToken);

    public async Task<InboxConversationItem?> Conversation(long id, CancellationToken cancellationToken) =>
        (await db.Query<InboxConversationItem>("USP_INBOX_CONVERSATION_LIST", new { Id = id, Take = 1 }, cancellationToken)).FirstOrDefault();

    public async Task<InboxCounts> Counts(CancellationToken cancellationToken) =>
        await db.Single<InboxCounts>("USP_INBOX_COUNTS", null, cancellationToken) ?? new InboxCounts();

    public Task ConversationUpdate(long id, string? status, bool? markRead, IReadOnlyList<string>? tags, CancellationToken cancellationToken) =>
        db.Execute("USP_INBOX_CONVERSATION_UPDATE", new
        {
            Id = id,
            StatusCode = status,
            MarkRead = markRead,
            Tags = tags is null ? null : string.Join(',', tags),
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    public Task<IReadOnlyList<InboxMessageItem>> Messages(long conversationId, InboxMessageQuery query, CancellationToken cancellationToken) =>
        db.Query<InboxMessageItem>("USP_INBOX_MESSAGE_LIST",
            new { ConversationId = conversationId, query.BeforeAt, query.BeforeId, Take = Math.Clamp(query.Take, 1, 200) }, cancellationToken);

    public async Task<InboxMessageItem?> Message(long id, CancellationToken cancellationToken) =>
        (await db.Query<InboxMessageItem>("USP_INBOX_MESSAGE_LIST", new { Id = id, Take = 1 }, cancellationToken)).FirstOrDefault();

    public Task<long> MessageCreate(long conversationId, string direction, string? body, string? options, string? parentExternalId, string userName,
        CancellationToken cancellationToken, IReadOnlyList<InboxAttachment>? attachments = null) =>
        db.Single<long>("USP_INBOX_MESSAGE_CREATE", new
        {
            ConversationId = conversationId,
            Direction = direction,
            Body = body,
            Attachments = attachments is null ? null : InboxAttachment.ToJson(attachments),
            Options = options,
            ParentExternalId = parentExternalId,
            UserName = userName,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    /// <summary>Adjuntos de un mensaje recibido con su copia local ya guardada.</summary>
    public Task MessageAttachmentsSave(long id, IReadOnlyList<InboxAttachment> attachments, CancellationToken cancellationToken) =>
        db.Execute("USP_BG_INBOX_MESSAGE_ATTACHMENTS_SAVE",
            new { Id = id, Attachments = InboxAttachment.ToJson(attachments), CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task<long> MessageResolve(long id, string action, CancellationToken cancellationToken) =>
        db.Single<long>("USP_INBOX_MESSAGE_RESOLVE", new { Id = id, Action = action, CurrentDate = TimeClock.UtcNow }, cancellationToken);
    #endregion

    #region COLA DE ENVÍO
    public Task<IReadOnlyList<InboxSendItem>> SendDue(int top, string leaseOwner, int leaseMinutes, CancellationToken cancellationToken) =>
        db.Query<InboxSendItem>("USP_BG_INBOX_SEND_DUE_LIST",
            new { Top = top, LeaseOwner = leaseOwner, LeaseMinutes = leaseMinutes, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    /// <summary>Devuelve la conversación, o null si otro proceso tomó la fila (lease perdido).</summary>
    public Task<long?> SendResult(long id, string leaseOwner, string status, string? externalId, string? error, DateTime? nextAttemptAt, CancellationToken cancellationToken) =>
        db.Single<long?>("USP_BG_INBOX_SEND_RESULT", new
        {
            Id = id,
            LeaseOwner = leaseOwner,
            StatusCode = status,
            ExternalId = externalId,
            ErrorMessage = error,
            NextAttemptAt = nextAttemptAt,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);
    #endregion

    #region CONTACTOS
    public Task<InboxContactDetail?> Contact(int id, CancellationToken cancellationToken) =>
        db.Read<InboxContactDetail?>("USP_INBOX_CONTACT_GET", new { Id = id }, async grid =>
        {
            var contact = await grid.ReadFirstOrDefaultAsync<InboxContactItem>();
            var linked = (await grid.ReadAsync<InboxContactItem>()).AsList();
            var invites = (await grid.ReadAsync<InboxInviteItem>()).AsList();
            return contact is null ? null : new InboxContactDetail { Contact = contact, Linked = linked, Invites = invites };
        }, cancellationToken);

    public Task<int> ContactCreate(string displayName, string? phone, string? email, string userName, CancellationToken cancellationToken) =>
        db.Single<int>("USP_INBOX_CONTACT_CREATE",
            new { DisplayName = displayName, Phone = phone, Email = email, UserName = userName, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    /// <summary>Conversación privada que empezamos nosotros (WhatsApp por número). Devuelve su id.</summary>
    public Task<long> ConversationStart(int connectionId, string externalId, string displayName, string? handle, int? personContactId,
        CancellationToken cancellationToken) =>
        db.Single<long>("USP_INBOX_CONVERSATION_START", new
        {
            ConnectionId = connectionId,
            ExternalId = externalId,
            DisplayName = displayName,
            Handle = handle,
            PersonContactId = personContactId,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    public Task<InboxInviteItem?> InviteCreate(string code, int contactId, int connectionId, string link, DateTime expiresAt, string userName,
        CancellationToken cancellationToken) =>
        db.Single<InboxInviteItem>("USP_INBOX_INVITE_CREATE", new
        {
            Code = code,
            ContactId = contactId,
            ConnectionId = connectionId,
            Link = link,
            ExpiresAt = expiresAt,
            UserName = userName,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    /// <summary>La persona abrió el chat con una invitación: true si se vinculó a su contacto.</summary>
    public Task<bool> InviteClaim(InboxReferral referral, CancellationToken cancellationToken) =>
        db.Single<bool>("USP_BG_INBOX_INVITE_CLAIM",
            new { referral.Code, referral.ConnectionId, referral.ContactExternalId, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task<IReadOnlyList<InboxContactItem>> ContactSearch(ContactSearchQuery query, CancellationToken cancellationToken) =>
        db.Query<InboxContactItem>("USP_INBOX_CONTACT_LIST",
            new { SearchTerm = string.IsNullOrWhiteSpace(query.SearchTerm) ? null : query.SearchTerm.Trim(), query.ExcludeId, Take = 20 }, cancellationToken);

    public Task ContactLink(int contactId, int? otherId, CancellationToken cancellationToken) =>
        db.Execute("USP_INBOX_CONTACT_LINK", new { ContactId = contactId, OtherId = otherId }, cancellationToken);
    #endregion

    #region CUENTAS Y CONSULTAS PERIÓDICAS
    public Task<IReadOnlyList<InboxAccountRow>> Accounts(CancellationToken cancellationToken) =>
        db.Query<InboxAccountRow>("USP_INBOX_ACCOUNT_LIST", null, cancellationToken);

    public Task AccountSettingsSave(int connectionId, bool direct, bool comments, CancellationToken cancellationToken) =>
        db.Execute("USP_INBOX_ACCOUNT_SETTINGS_SAVE", new { ConnectionId = connectionId, InboxDirect = direct, InboxComments = comments }, cancellationToken);

    public Task SyncSave(string syncKey, string? cursor, DateTime nextRunAt, bool isOk, string? error, CancellationToken cancellationToken) =>
        db.Execute("USP_INBOX_SYNC_SAVE",
            new { SyncKey = syncKey, Cursor = cursor, NextRunAt = nextRunAt, IsOk = isOk, Error = error, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task<IReadOnlyList<InboxPublicationRow>> PublicationsRecent(int connectionId, DateTime since, CancellationToken cancellationToken) =>
        db.Query<InboxPublicationRow>("USP_INBOX_PUBLICATIONS_RECENT", new { ConnectionId = connectionId, Since = since }, cancellationToken);
    #endregion

    #region RESULTADOS, INICIO Y RETENCIÓN
    public Task<(IReadOnlyList<InboxStatsDay> Daily, IReadOnlyList<InboxStatsPlatform> Platforms)> Stats(DateTime from, CancellationToken cancellationToken) =>
        db.Multiple<InboxStatsDay, InboxStatsPlatform>("USP_INBOX_STATS", new { From = from }, cancellationToken);

    public Task<(HomeKpis Kpis, IReadOnlyList<HomeAgendaItem> Agenda, IReadOnlyList<HomeActivityDay> Activity)> Home(DateTime dayStart, DateTime dayEnd,
        CancellationToken cancellationToken) =>
        db.Read<(HomeKpis, IReadOnlyList<HomeAgendaItem>, IReadOnlyList<HomeActivityDay>)>("USP_HOME_SUMMARY",
            new { DayStart = dayStart, DayEnd = dayEnd, CurrentDate = TimeClock.UtcNow }, async grid =>
            (await grid.ReadFirstOrDefaultAsync<HomeKpis>() ?? new HomeKpis(),
             (await grid.ReadAsync<HomeAgendaItem>()).AsList(),
             (await grid.ReadAsync<HomeActivityDay>()).AsList()), cancellationToken);

    public Task<(int Events, int Messages)> Purge(DateTime eventsBefore, DateTime messagesBefore, CancellationToken cancellationToken) =>
        db.Read<(int, int)>("USP_BG_INBOX_PURGE", new { EventsBefore = eventsBefore, MessagesBefore = messagesBefore }, async grid =>
        {
            var row = await grid.ReadFirstAsync<(int Events, int Messages)>();
            return (row.Events, row.Messages);
        }, cancellationToken);
    #endregion
}
