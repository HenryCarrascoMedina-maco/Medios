namespace YoutubeMeta.Api.Domain.Requests;

#region BANDEJA
public sealed class InboxConversationQuery
{
    public string? Status { get; set; }
    public string? Platform { get; set; }
    public string? Kind { get; set; }
    public int? ConnectionId { get; set; }
    public bool Unread { get; set; }
    public bool Awaiting { get; set; }
    public string? Tag { get; set; }
    public string? SearchTerm { get; set; }
    /// <summary>Cursor: LastMessageAt e Id de la última conversación de la página anterior.</summary>
    public DateTime? BeforeAt { get; set; }
    public long? BeforeId { get; set; }
    public int Take { get; set; } = 30;
}

public sealed class InboxMessageQuery
{
    public DateTime? BeforeAt { get; set; }
    public long? BeforeId { get; set; }
    public int Take { get; set; } = 50;
}

/// <summary>Respuesta o nota interna. Con TemplateName (WhatsApp), Body se ignora.</summary>
public sealed class InboxReplyRequest
{
    public string? Body { get; set; }
    /// <summary>true = nota interna: no se envía, solo la ve el equipo.</summary>
    public bool Note { get; set; }
    /// <summary>Comentario al que se responde (comentarios) o mensaje citado.</summary>
    public string? ParentExternalId { get; set; }
    /// <summary>Messenger / Instagram: responder por privado al autor del comentario.</summary>
    public bool PrivateReply { get; set; }
    public List<int> MediaIds { get; set; } = [];
    public string? TemplateName { get; set; }
    public string? TemplateLanguage { get; set; }
    public List<string> TemplateParams { get; set; } = [];
}

public sealed class InboxConversationUpdateRequest
{
    public string? StatusCode { get; set; }
    public bool? MarkRead { get; set; }
    /// <summary>null = no tocar; lista (vacía o no) = reemplaza las etiquetas.</summary>
    public List<string>? Tags { get; set; }
}

public sealed class InboxMessageResolveRequest
{
    /// <summary>RETRY, MARK_SENT o CANCEL.</summary>
    public string Action { get; set; } = string.Empty;
}

public sealed class InboxAccountSettingsRequest
{
    public bool InboxDirect { get; set; }
    public bool InboxComments { get; set; }
}

public sealed class ContactSearchQuery
{
    public string? SearchTerm { get; set; }
    public int? ExcludeId { get; set; }
}

/// <summary>Vincula el contacto con otro (la misma persona en otra red); OtherId null = desvincular.</summary>
public sealed class ContactLinkRequest
{
    public int? OtherId { get; set; }
}

/// <summary>Alta en la agenda: una persona que aún no escribió por ninguna red.</summary>
public sealed class ContactCreateRequest
{
    public string DisplayName { get; set; } = string.Empty;
    /// <summary>Con código de país: +51 987 654 321 (los espacios y guiones se quitan).</summary>
    public string? Phone { get; set; }
    public string? Email { get; set; }
}

/// <summary>
/// Escribir primero a alguien por WhatsApp: a su número y con una plantilla aprobada (WhatsApp no deja empezar con
/// texto libre). ContactId = su ficha (de la agenda o de otra red) para vincularlas.
/// </summary>
public sealed class ConversationStartRequest
{
    public int ConnectionId { get; set; }
    public int? ContactId { get; set; }
    public string Phone { get; set; } = string.Empty;
    public string? DisplayName { get; set; }
    public string TemplateName { get; set; } = string.Empty;
    public string? TemplateLanguage { get; set; }
    public List<string> TemplateParams { get; set; } = [];
    /// <summary>La persona aceptó recibir mensajes de WhatsApp de la empresa (lo exige Meta).</summary>
    public bool Consent { get; set; }
}

/// <summary>Enlace para que la persona abra el chat en Telegram, Messenger o Instagram (no dejan escribir primero).</summary>
public sealed class InviteCreateRequest
{
    public int ConnectionId { get; set; }
    public int ContactId { get; set; }
}
#endregion

#region INICIO
/// <summary>El día de hoy del usuario en UTC (el servidor no sabe su zona horaria). Sin valores: el día UTC.</summary>
public sealed class HomeQuery
{
    public DateTime? DayStart { get; set; }
    public DateTime? DayEnd { get; set; }
}
#endregion
