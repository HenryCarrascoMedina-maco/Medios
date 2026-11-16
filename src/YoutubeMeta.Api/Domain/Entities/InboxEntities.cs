using System.Text.Json;

namespace YoutubeMeta.Api.Domain.Entities;

/// <summary>Aviso en crudo reservado por el job (USP_BG_INBOX_EVENT_DUE_LIST).</summary>
public sealed class InboxEventRow
{
    public long Id { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string EventKey { get; set; } = string.Empty;
    public string Payload { get; set; } = string.Empty;
    public int Attempts { get; set; }
}

/// <summary>Cuenta que puede recibir en la bandeja (USP_INBOX_ACCOUNT_LIST). No lleva el token.</summary>
public sealed class InboxAccountRow
{
    public int Id { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string ConnectionKey { get; set; } = string.Empty;
    public string ExternalId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public string? AccountHint { get; set; }
    public string StatusCode { get; set; } = string.Empty;
    public string? Scopes { get; set; }
    public int? CredentialId { get; set; }
    public string? CredentialName { get; set; }
    public string? Extra { get; set; }
    public bool InboxDirect { get; set; }
    public bool InboxComments { get; set; }
    public bool IsDefault { get; set; }
    public string SyncKey { get; set; } = string.Empty;
    public string? SyncCursor { get; set; }
    public DateTime? NextRunAt { get; set; }
    public DateTime? LastRunAt { get; set; }
    public DateTime? LastOkAt { get; set; }
    public string? LastError { get; set; }
    public int OpenConversations { get; set; }
    public DateTime? LastInboundAt { get; set; }

    public bool HasScope(string scope) => Scopes?.Split(' ', ',').Contains(scope, StringComparer.OrdinalIgnoreCase) == true;
}

/// <summary>Respuesta reservada por el job para enviarla (USP_BG_INBOX_SEND_DUE_LIST).</summary>
public sealed class InboxSendItem
{
    public long Id { get; set; }
    public long ConversationId { get; set; }
    public string? Body { get; set; }
    public string? Attachments { get; set; }
    public string? Options { get; set; }
    public string? ParentExternalId { get; set; }
    public int Attempts { get; set; }
    public string? CreatedBy { get; set; }
    public string Kind { get; set; } = string.Empty;
    public string ConversationExternalId { get; set; } = string.Empty;
    public DateTime? LastInboundAt { get; set; }
    public string? ContactExternalId { get; set; }
    public int ConnectionId { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string ConnectionKey { get; set; } = string.Empty;
    public string AccountExternalId { get; set; } = string.Empty;
    public int? CredentialId { get; set; }
    public string ConnectionStatus { get; set; } = string.Empty;
    public string AccountName { get; set; } = string.Empty;
    public string? AccountExtra { get; set; }

    public InboxSendOptions SendOptions => InboxSendOptions.Parse(Options);
}

public sealed class InboxIngestResult
{
    public long ConversationId { get; set; }
    public long MessageId { get; set; }
    public bool IsNew { get; set; }
}

/// <summary>Publicación ya hecha de una cuenta (USP_INBOX_PUBLICATIONS_RECENT).</summary>
public sealed class InboxPublicationRow
{
    public long Id { get; set; }
    public string ExternalId { get; set; } = string.Empty;
    public string? ExternalUrl { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateTime CompletedAt { get; set; }
}

/// <summary>Adjunto de un mensaje (Inbox_Messages.Attachments, JSON).</summary>
public sealed class InboxAttachment
{
    /// <summary>image, video, audio, document, sticker u other.</summary>
    public string Kind { get; set; } = "other";
    public string? Name { get; set; }
    /// <summary>Enlace directo (Messenger, Instagram) cuando la plataforma lo da.</summary>
    public string? Url { get; set; }
    /// <summary>Id del archivo en la plataforma (WhatsApp, Telegram): se descarga bajo demanda por la API.</summary>
    public string? MediaId { get; set; }
    /// <summary>Archivo de la biblioteca que enviamos nosotros: se sirve desde el almacenamiento propio.</summary>
    public int? LibraryId { get; set; }
    /// <summary>Copia local de un archivo recibido (ruta relativa a Storage:Root): sigue abriendo cuando la red lo caduca.</summary>
    public string? StoredPath { get; set; }
    public string? ContentType { get; set; }

    public static InboxAttachment FromLibrary(VideoRow file) => new()
    {
        Kind = file.MediaKind switch
        {
            MediaKinds.Image => "image",
            MediaKinds.Video => "video",
            MediaKinds.Document => "document",
            _ => "other"
        },
        Name = string.IsNullOrWhiteSpace(file.OriginalFileName) ? file.Title : file.OriginalFileName,
        LibraryId = file.Id,
        ContentType = file.ContentType
    };

    public static string? ToJson(IReadOnlyList<InboxAttachment> attachments) =>
        attachments.Count == 0 ? null : JsonSerializer.Serialize(attachments, JsonColumn.Options);

    public static IReadOnlyList<InboxAttachment> Parse(string? json) => JsonColumn.Parse<List<InboxAttachment>>(json);
}

/// <summary>Opciones de una respuesta (Inbox_Messages.Options, JSON): cómo se envía.</summary>
public sealed class InboxSendOptions
{
    /// <summary>Responder por privado a un comentario (Messenger / Instagram).</summary>
    public bool PrivateReply { get; set; }
    public List<int> MediaIds { get; set; } = [];
    /// <summary>WhatsApp fuera de la ventana de 24 h: plantilla aprobada, idioma y valores de {{1}}, {{2}}…</summary>
    public string? TemplateName { get; set; }
    public string? TemplateLanguage { get; set; }
    public List<string> TemplateParams { get; set; } = [];

    public string? ToJson()
    {
        if (!PrivateReply && MediaIds.Count == 0 && TemplateName is null) return null;
        return JsonSerializer.Serialize(this, JsonColumn.Options);
    }

    public static InboxSendOptions Parse(string? json) => JsonColumn.Parse<InboxSendOptions>(json);
}

#region NORMALIZADO (lo que el adaptador de cada plataforma saca de un aviso)
/// <summary>Algo que trae un aviso: un mensaje o un acuse de un mensaje enviado.</summary>
public abstract record InboxUpdate;

public sealed record InboxContact(string ExternalId, string? Name, string? Handle = null, string? AvatarUrl = null);

/// <summary>Un mensaje de una conversación (entrante, o saliente hecho desde la propia plataforma).</summary>
public sealed record InboxIncoming(
    int ConnectionId,
    string Kind,
    string ConversationExternalId,
    string? Title,
    string MessageExternalId,
    string Direction,
    DateTime SentAt,
    string? Body,
    InboxContact? Contact = null,
    string? AuthorName = null,
    string? AuthorExternalId = null,
    string? ParentExternalId = null,
    string? Link = null,
    string? PublicationExternalId = null) : InboxUpdate
{
    public IReadOnlyList<InboxAttachment> Attachments { get; init; } = [];
}

/// <summary>Acuse de un mensaje enviado: entregado, leído o fallido.</summary>
public sealed record InboxStatusChange(string ExternalId, string Status, string? Error = null) : InboxUpdate;

/// <summary>
/// La persona abrió el chat con un enlace de invitación (Telegram /start, referencia de Messenger o Instagram):
/// su cuenta en la red se vincula al contacto de la invitación.
/// </summary>
public sealed record InboxReferral(int ConnectionId, string ContactExternalId, string Code) : InboxUpdate;

/// <summary>Aviso en crudo que una consulta periódica guarda en Inbox_Events (clave única por plataforma).</summary>
public sealed record InboxRawEvent(string Key, string Payload);
#endregion

/// <summary>Cifras del panel principal (primer resultado de USP_HOME_SUMMARY).</summary>
public sealed class HomeKpis
{
    public int Awaiting { get; set; }
    public int WindowsClosing { get; set; }
    public double? AvgResponseMinutes { get; set; }
    public double? AvgResponseMinutesPrevious { get; set; }
    public int PublishedToday { get; set; }
    public int ScheduledToday { get; set; }
    public int FailedRecent { get; set; }
    public int Connections { get; set; }
    public int ConnectionsAttention { get; set; }
}
