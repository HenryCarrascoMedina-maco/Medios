using System.Text.Json.Serialization;

namespace YoutubeMeta.Api.Domain.Responses;

#region BANDEJA
/// <summary>Conversación (USP_INBOX_CONVERSATION_LIST) más lo que calcula la API: hasta cuándo se puede responder.</summary>
public sealed class InboxConversationItem
{
    public long Id { get; set; }
    public int ConnectionId { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string AccountName { get; set; } = string.Empty;
    public string? AccountAvatarUrl { get; set; }
    public string Kind { get; set; } = string.Empty;
    public string ExternalId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Link { get; set; }
    public string StatusCode { get; set; } = string.Empty;
    public int UnreadCount { get; set; }
    public DateTime LastMessageAt { get; set; }
    public string? LastMessagePreview { get; set; }
    public DateTime? LastInboundAt { get; set; }
    public DateTime? AwaitingSince { get; set; }
    public string? AssignedTo { get; set; }
    public long? PublicationId { get; set; }
    public int? VideoId { get; set; }
    public int? ContactId { get; set; }
    public string? ContactName { get; set; }
    public string? ContactHandle { get; set; }
    public string? ContactAvatarUrl { get; set; }

    /// <summary>Messenger, Instagram y WhatsApp: hasta cuándo se puede responder con texto libre.</summary>
    public DateTime? WindowExpiresAt { get; set; }

    /// <summary>La conversación la empezamos nosotros y la persona aún no escribió: solo plantilla (WhatsApp).</summary>
    public bool WindowNeverOpened { get; set; }

    [JsonIgnore] public string? Tags { get; set; }

    [JsonPropertyName("tags")]
    public string[] TagList => string.IsNullOrEmpty(Tags) ? [] : Tags.Split(',');
}

public sealed class InboxMessageItem
{
    public long Id { get; set; }
    public long ConversationId { get; set; }
    public string? ExternalId { get; set; }
    public string? ParentExternalId { get; set; }
    public string Direction { get; set; } = string.Empty;
    public string? AuthorName { get; set; }
    public string? AuthorExternalId { get; set; }
    public string? Body { get; set; }
    public DateTime SentAt { get; set; }
    public string StatusCode { get; set; } = string.Empty;
    public string? ErrorMessage { get; set; }
    public int Attempts { get; set; }
    public string? CreatedBy { get; set; }

    [JsonIgnore] public string? Attachments { get; set; }
    [JsonIgnore] public string? Options { get; set; }

    /// <summary>
    /// Adjuntos del mensaje. Las respuestas enviadas antes de guardar sus adjuntos solo tienen los MediaIds de las
    /// opciones: se muestran igual, sin nombre, para que se vea que el archivo se envió.
    /// </summary>
    [JsonPropertyName("attachments")]
    public IReadOnlyList<InboxAttachment> AttachmentList
    {
        get
        {
            var list = InboxAttachment.Parse(Attachments);
            if (list.Count > 0 || Direction != InboxDirections.Out) return list;
            return InboxSendOptions.Parse(Options).MediaIds.Select(id => new InboxAttachment { LibraryId = id }).ToList();
        }
    }

    /// <summary>Plantilla de WhatsApp con la que se envió (para mostrarlo en la burbuja).</summary>
    public string? Template => InboxSendOptions.Parse(Options).TemplateName;

    public bool PrivateReply => InboxSendOptions.Parse(Options).PrivateReply;
}

public sealed class InboxCounts
{
    public int Open { get; set; }
    public int Pending { get; set; }
    public int Closed { get; set; }
    public int Unread { get; set; }
    public int Awaiting { get; set; }
}

public sealed class InboxContactItem
{
    public int Id { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string ExternalId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? Handle { get; set; }
    public string? AvatarUrl { get; set; }
    public int? PersonId { get; set; }
    /// <summary>Agenda: teléfono (+código país) y correo, para escribirle o mandarle invitaciones.</summary>
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public DateTime CreatedAt { get; set; }
    public int Conversations { get; set; }
    public long? LastConversationId { get; set; }
}

public sealed class InboxContactDetail
{
    public InboxContactItem Contact { get; set; } = new();
    /// <summary>La misma persona en otras redes y en la agenda (vinculada a mano o por una invitación).</summary>
    public IReadOnlyList<InboxContactItem> Linked { get; set; } = [];
    /// <summary>Invitaciones por enlace enviadas a esta persona (las últimas).</summary>
    public IReadOnlyList<InboxInviteItem> Invites { get; set; } = [];
}

/// <summary>Enlace de invitación para que la persona abra el chat (Telegram, Messenger, Instagram).</summary>
public sealed class InboxInviteItem
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public int ContactId { get; set; }
    public int ConnectionId { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string AccountName { get; set; } = string.Empty;
    public string Link { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    /// <summary>Cuándo la persona abrió el chat con el enlace (null = pendiente).</summary>
    public DateTime? UsedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public static class InboxModes
{
    /// <summary>La plataforma avisa al instante (webhook).</summary>
    public const string Webhook = "WEBHOOK";
    /// <summary>La app pregunta cada X minutos.</summary>
    public const string Poll = "POLL";
    /// <summary>Esta cuenta no puede recibir en la bandeja.</summary>
    public const string None = "NONE";
}

/// <summary>Configuración › Bandeja: una cuenta, qué puede recibir y si le falta algo.</summary>
public sealed class InboxAccountItem
{
    public int Id { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public string? AccountHint { get; set; }
    public string StatusCode { get; set; } = string.Empty;
    public string? CredentialName { get; set; }
    public bool InboxDirect { get; set; }
    public bool InboxComments { get; set; }
    public bool SupportsDirect { get; set; }
    public bool SupportsComments { get; set; }
    public string Mode { get; set; } = InboxModes.None;
    /// <summary>Qué falta para recibir (para el usuario) y cómo se arregla: RECONNECT, SETTINGS o GUIDE.</summary>
    public string? Problem { get; set; }
    public string? Fix { get; set; }
    public DateTime? LastOkAt { get; set; }
    public string? LastError { get; set; }
    public DateTime? LastInboundAt { get; set; }
    public int OpenConversations { get; set; }
}

public sealed class InboxSettingsResponse
{
    public IReadOnlyList<InboxAccountItem> Accounts { get; set; } = [];
    /// <summary>La API tiene dirección pública https (App:PublicBaseUrl): los webhooks pueden llegar.</summary>
    public bool PublicUrlConfigured { get; set; }
    /// <summary>URL que se pega en la app de Meta (Webhooks) y el texto de verificación.</summary>
    public string? MetaWebhookUrl { get; set; }
    public string? MetaVerifyToken { get; set; }
    public bool MetaAppConfigured { get; set; }
    public bool HumanAgentEnabled { get; set; }
    public int RetentionMonths { get; set; }
    /// <summary>Se guarda una copia de los archivos recibidos (Inbox:KeepReceivedFiles) y hasta qué tamaño.</summary>
    public bool KeepReceivedFiles { get; set; }
    public int KeepFileMaxMb { get; set; }
    public int InviteDays { get; set; }
}

public sealed class WhatsAppTemplateItem
{
    public string Name { get; set; } = string.Empty;
    public string Language { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    /// <summary>Cuántas variables {{n}} tiene el cuerpo.</summary>
    public int ParamCount { get; set; }
}

public sealed class InboxStatsDay
{
    public DateTime Day { get; set; }
    public int Received { get; set; }
    public int Sent { get; set; }
}

public sealed class InboxStatsPlatform
{
    public string Platform { get; set; } = string.Empty;
    public int Received { get; set; }
    public int Sent { get; set; }
    public int Conversations { get; set; }
    public double? AvgResponseMinutes { get; set; }
}

public sealed class InboxStats
{
    public int Received { get; set; }
    public int Sent { get; set; }
    public double? AvgResponseMinutes { get; set; }
    public IReadOnlyList<InboxStatsDay> Daily { get; set; } = [];
    public IReadOnlyList<InboxStatsPlatform> Platforms { get; set; } = [];
}
#endregion

#region INICIO
public sealed class HomeAgendaItem
{
    public long Id { get; set; }
    public int? VideoId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Target { get; set; } = string.Empty;
    public string ConnectionName { get; set; } = string.Empty;
    public string StatusCode { get; set; } = string.Empty;
    public DateTime At { get; set; }
    /// <summary>true = falló o necesita revisión; false = programada.</summary>
    public bool IsProblem { get; set; }
}

public sealed class HomeActivityDay
{
    public DateTime Day { get; set; }
    public int Received { get; set; }
    public int Published { get; set; }
}

public sealed class HomeSummary
{
    public HomeKpis Kpis { get; set; } = new();
    /// <summary>Conversaciones sin responder, primero las que cierran antes su ventana de 24 h.</summary>
    public IReadOnlyList<InboxConversationItem> Urgent { get; set; } = [];
    public IReadOnlyList<HomeAgendaItem> Agenda { get; set; } = [];
    public IReadOnlyList<HomeActivityDay> Activity { get; set; } = [];
}
#endregion
