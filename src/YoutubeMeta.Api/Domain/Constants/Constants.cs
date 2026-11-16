namespace YoutubeMeta.Api.Domain.Constants;

public static class AppClaims
{
    public const string Id = "id";
    public const string Name = "name";
}

public static class Platforms
{
    public const string YouTube = "YOUTUBE";
    public const string Facebook = "FACEBOOK";
    public const string Instagram = "INSTAGRAM";
    public const string Telegram = "TELEGRAM";
    public const string TikTok = "TIKTOK";
    public const string LinkedIn = "LINKEDIN";
    public const string Teams = "TEAMS";
    /// <summary>Solo bandeja (WhatsApp Business Cloud API): no publica, así que no está en <see cref="All"/>.</summary>
    public const string WhatsApp = "WHATSAPP";

    /// <summary>
    /// Solo en Platform_Credentials: la app de LinkedIn para páginas de empresa (Community Management API) es otra
    /// app, con su propio Client ID. Las cuentas que conecta siguen siendo de la plataforma LINKEDIN.
    /// </summary>
    public const string LinkedInOrgCredential = "LINKEDIN_ORG";

    /// <summary>Solo en Platform_Credentials: la app de Meta (App ID + App Secret) con la que se firman los webhooks.</summary>
    public const string MetaAppCredential = "META";

    public static readonly string[] All = [YouTube, Facebook, Instagram, Telegram, TikTok, LinkedIn, Teams];

    public static bool IsValid(string? value) => value != null && All.Contains(value);

    /// <summary>Todas las que se conectan en Conexiones: las que publican y WhatsApp.</summary>
    public static readonly string[] Connectable = [.. All, WhatsApp];

    public static bool IsConnectable(string? value) => value != null && Connectable.Contains(value);

    public static string Label(string platform) => platform switch
    {
        YouTube => "YouTube",
        Facebook => "Facebook",
        Instagram => "Instagram",
        Telegram => "Telegram",
        TikTok => "TikTok",
        LinkedIn => "LinkedIn",
        Teams => "Teams",
        WhatsApp => "WhatsApp",
        _ => platform
    };

    /// <summary>Canal de Teams conectado con un webhook de Workflows (no con Microsoft Graph).</summary>
    public const string TeamsWebhookPrefix = "webhook:";

    public static bool IsTeamsWebhook(string platform, string externalId) =>
        platform == Teams && externalId.StartsWith(TeamsWebhookPrefix, StringComparison.Ordinal);
}

/// <summary>Qué se publica (Posts.Kind). Se deduce de los archivos elegidos y del enlace: ver PostRules.</summary>
public static class PostKinds
{
    public const string Text = "TEXT";
    public const string Link = "LINK";
    public const string Image = "IMAGE";
    public const string Carousel = "CAROUSEL";
    public const string Video = "VIDEO";
    public const string Document = "DOCUMENT";

    public static readonly string[] All = [Text, Link, Image, Carousel, Video, Document];

    public static string Label(string kind) => kind switch
    {
        Text => "texto",
        Link => "enlace",
        Image => "imagen",
        Carousel => "carrusel de imágenes",
        Video => "video",
        Document => "documento PDF",
        _ => kind
    };

    public static bool HasMedia(string kind) => kind is Image or Carousel or Video or Document;
}

/// <summary>Tipo de archivo de la biblioteca (Media_Assets.MediaKind).</summary>
public static class MediaKinds
{
    public const string Video = "VIDEO";
    public const string Image = "IMAGE";
    public const string Document = "DOCUMENT";

    public static readonly string[] All = [Video, Image, Document];

    public static bool IsValid(string? value) => value != null && All.Contains(value);
}

/// <summary>Para qué es una plantilla propia (Templates.Usage).</summary>
public static class TemplateUsages
{
    /// <summary>Texto (y adjuntos) del diálogo de publicación.</summary>
    public const string Publish = "PUBLISH";
    /// <summary>Respuesta de la bandeja: se elige escribiendo /atajo.</summary>
    public const string Reply = "REPLY";

    public static readonly string[] All = [Publish, Reply];

    public static bool IsValid(string? value) => value != null && All.Contains(value);
}

public static class PublicationStatus
{
    public const string Pending = "PENDING";
    public const string Uploading = "UPLOADING";
    public const string Processing = "PROCESSING";
    public const string Done = "DONE";
    public const string Failed = "FAILED";
    public const string WaitingQuota = "WAITING_QUOTA";
    public const string NeedsReconnect = "NEEDS_RECONNECT";
    public const string Cancelled = "CANCELLED";
    /// <summary>
    /// Resultado dudoso que el sistema no pudo comprobar solo (p. ej. se cortó la red justo cuando Telegram
    /// recibía el video). Espera a que una persona diga si ya está publicado o hay que volver a subirlo.
    /// </summary>
    public const string NeedsReview = "NEEDS_REVIEW";
}

/// <summary>Cómo se resuelve a mano una publicación en <see cref="PublicationStatus.NeedsReview"/> o fallida.</summary>
public static class PublicationResolution
{
    /// <summary>La persona comprobó que ya está en la plataforma.</summary>
    public const string MarkDone = "MARK_DONE";
    /// <summary>Se sube otra vez desde cero.</summary>
    public const string Reupload = "REUPLOAD";

    public static bool IsValid(string? value) => value is MarkDone or Reupload;
}

public static class ConnectionStatus
{
    public const string Connected = "CONNECTED";
    public const string NeedsReconnect = "NEEDS_RECONNECT";
    public const string Revoked = "REVOKED";
}

/// <summary>
/// Visibilidad guardada en Video_Publications. YouTube usa public/unlisted/private; TikTok además
/// followers (FOLLOWER_OF_CREATOR) y friends (MUTUAL_FOLLOW_FRIENDS).
/// </summary>
public static class PrivacyStatus
{
    public const string Public = "public";
    public const string Unlisted = "unlisted";
    public const string Private = "private";
    public const string Followers = "followers";
    public const string Friends = "friends";
    /// <summary>LinkedIn (perfil personal): solo tus contactos.</summary>
    public const string Connections = "connections";

    public static readonly string[] Youtube = [Public, Unlisted, Private];
    public static readonly string[] Tiktok = [Public, Followers, Friends, Private];
    public static readonly string[] Linkedin = [Public, Connections];
}

public static class QuotaBuckets
{
    public const string Uploads = "UPLOADS";
    public const string General = "GENERAL";
    public const int UploadsLimit = 100;
    public const int GeneralLimit = 10_000;
}

/// <summary>Nombres de entidad del evento ReceiveEntityUpdate (mismo contrato que el EntityHub de Sinsatools).</summary>
public static class RealTimeEntities
{
    public const string VideoUpload = "VideoUpload";
    public const string VideoPublish = "VideoPublish";
    public const string Connection = "Connection";
    public const string Credential = "Credential";
    /// <summary>Bandeja: llegó o cambió un mensaje (payload: conversationId, isNew).</summary>
    public const string Inbox = "Inbox";
}

/// <summary>Tipo de conversación de la bandeja (Inbox_Conversations.Kind).</summary>
public static class InboxKinds
{
    /// <summary>Mensaje privado con una persona.</summary>
    public const string Direct = "DIRECT";
    /// <summary>Comentarios públicos bajo una publicación (una conversación por publicación).</summary>
    public const string Comments = "COMMENTS";
    /// <summary>Grupo de discusión de un canal de Telegram.</summary>
    public const string Group = "GROUP";

    public static readonly string[] All = [Direct, Comments, Group];

    public static bool IsValid(string? value) => value != null && All.Contains(value);
}

/// <summary>
/// Agenda: contactos dados de alta a mano (Inbox_Contacts.Platform = AGENDA), sin cuenta en una red todavía.
/// Sus cuentas en las redes se vinculan a ellos (al escribirles por WhatsApp o cuando abren una invitación).
/// </summary>
public static class InboxAgenda
{
    public const string Platform = "AGENDA";

    /// <summary>Código de invitación: va en t.me/bot?start=… y m.me/pagina?ref=… (solo letras y números).</summary>
    public const string InvitePrefix = "inv";

    public static string NewInviteCode() =>
        InvitePrefix + Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();

    public static bool IsInviteCode(string? value) =>
        value is { Length: > 3 and <= 40 } && value.StartsWith(InvitePrefix, StringComparison.Ordinal) && value.All(char.IsAsciiLetterOrDigit);
}

public static class InboxDirections
{
    public const string In = "IN";
    public const string Out = "OUT";
    /// <summary>Nota interna: solo la ve el equipo, nunca se envía.</summary>
    public const string Note = "NOTE";
}

public static class InboxConversationStatus
{
    public const string Open = "OPEN";
    public const string Pending = "PENDING";
    public const string Closed = "CLOSED";

    public static readonly string[] All = [Open, Pending, Closed];

    public static bool IsValid(string? value) => value != null && All.Contains(value);
}

public static class InboxMessageStatus
{
    public const string Received = "RECEIVED";
    public const string Queued = "QUEUED";
    public const string Sending = "SENDING";
    public const string Sent = "SENT";
    public const string Delivered = "DELIVERED";
    public const string Read = "READ";
    public const string Failed = "FAILED";
    /// <summary>Se cortó el envío y no se sabe si llegó: decide una persona (igual que en Publications).</summary>
    public const string NeedsReview = "NEEDS_REVIEW";
    public const string Cancelled = "CANCELLED";
}

/// <summary>Cómo se resuelve a mano un envío fallido o dudoso de la bandeja.</summary>
public static class InboxResolution
{
    public const string Retry = "RETRY";
    public const string MarkSent = "MARK_SENT";
    public const string Cancel = "CANCEL";

    public static bool IsValid(string? value) => value is Retry or MarkSent or Cancel;
}

/// <summary>Estado de Inbox_Events.</summary>
public static class InboxEventStatus
{
    public const string Pending = "PENDING";
    public const string Done = "DONE";
    public const string Failed = "FAILED";
}
