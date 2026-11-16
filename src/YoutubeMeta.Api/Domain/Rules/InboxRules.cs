namespace YoutubeMeta.Api.Domain.Rules;

/// <summary>
/// Reglas de respuesta de cada plataforma en la bandeja: una sola fuente para validar en la API y para que el
/// compositor del front avise mientras se escribe (GET /api/Inbox/Rules).
/// </summary>
public static class InboxRules
{
    /// <summary>Messenger, Instagram y WhatsApp solo dejan responder en texto libre hasta 24 h después del último mensaje del cliente.</summary>
    public const int WindowHours = 24;

    /// <summary>Etiqueta «agente humano» de Meta: 7 días en lugar de 24 h (la app necesita el permiso aprobado por Meta).</summary>
    public const int HumanAgentDays = 7;

    /// <summary>Unidades de cuota de YouTube: responder un comentario (comments.insert) y leer una página de comentarios.</summary>
    public const int YoutubeReplyUnits = 50;
    public const int YoutubeListUnits = 1;

    public const int NoteMax = 4000;

    private static readonly InboxCapability None = new(0, null, false, false, false, false);

    /// <summary>Qué admite cada plataforma y tipo de conversación. Clave: «PLATAFORMA:TIPO».</summary>
    public static readonly IReadOnlyDictionary<string, InboxCapability> Capabilities = new Dictionary<string, InboxCapability>
    {
        [Key(Platforms.Facebook, InboxKinds.Direct)] = new(2000, WindowHours, Attachments: true, AttachmentsNeedPublicUrl: true, PrivateReply: false, Templates: false),
        [Key(Platforms.Facebook, InboxKinds.Comments)] = new(8000, null, false, false, PrivateReply: true, false),
        [Key(Platforms.Instagram, InboxKinds.Direct)] = new(1000, WindowHours, Attachments: true, AttachmentsNeedPublicUrl: true, PrivateReply: false, Templates: false),
        [Key(Platforms.Instagram, InboxKinds.Comments)] = new(2200, null, false, false, PrivateReply: true, false),
        [Key(Platforms.WhatsApp, InboxKinds.Direct)] = new(4096, WindowHours, Attachments: true, AttachmentsNeedPublicUrl: false, PrivateReply: false, Templates: true),
        [Key(Platforms.Telegram, InboxKinds.Direct)] = new(4096, null, Attachments: true, AttachmentsNeedPublicUrl: false, PrivateReply: false, Templates: false),
        [Key(Platforms.Telegram, InboxKinds.Group)] = new(4096, null, Attachments: true, AttachmentsNeedPublicUrl: false, PrivateReply: false, Templates: false),
        [Key(Platforms.YouTube, InboxKinds.Comments)] = new(10000, null, false, false, false, false, QuotaUnits: YoutubeReplyUnits),
        [Key(Platforms.Teams, InboxKinds.Comments)] = new(20000, null, false, false, false, false)
    };

    public static string Key(string platform, string kind) => $"{platform}:{kind}";

    public static InboxCapability For(string platform, string kind) => Capabilities.GetValueOrDefault(Key(platform, kind), None);

    /// <summary>Hasta cuándo se puede responder con texto libre; null = sin ventana (o sin mensaje del cliente todavía).</summary>
    public static DateTime? WindowExpiresAt(string platform, string kind, DateTime? lastInboundAt) =>
        For(platform, kind).WindowHours is { } hours && lastInboundAt is { } at ? at.AddHours(hours) : null;

    /// <summary>
    /// La conversación tiene ventana pero la persona nunca escribió: la empezamos nosotros (WhatsApp por número) y
    /// hasta que conteste solo vale una plantilla.
    /// </summary>
    public static bool WindowNeverOpened(string platform, string kind, DateTime? lastInboundAt) =>
        lastInboundAt is null && For(platform, kind).WindowHours is not null;

    /// <summary>Hasta cuándo se puede responder: lo calcula esta sola regla para la bandeja y el inicio.</summary>
    public static InboxConversationItem WithWindow(InboxConversationItem item)
    {
        item.WindowExpiresAt = WindowExpiresAt(item.Platform, item.Kind, item.LastInboundAt);
        item.WindowNeverOpened = WindowNeverOpened(item.Platform, item.Kind, item.LastInboundAt);
        return item;
    }

    /// <summary>Qué hace falta para enviar ahora: nada, la etiqueta «agente humano» o una plantilla.</summary>
    public static InboxWindowState Window(string platform, string kind, DateTime? lastInboundAt, DateTime now, bool humanAgentEnabled)
    {
        if (WindowNeverOpened(platform, kind, lastInboundAt)) return InboxWindowState.Closed;
        if (WindowExpiresAt(platform, kind, lastInboundAt) is not { } expires || now <= expires) return InboxWindowState.Open;
        if (humanAgentEnabled && platform is Platforms.Facebook or Platforms.Instagram && now <= lastInboundAt!.Value.AddDays(HumanAgentDays))
            return InboxWindowState.HumanAgent;
        return InboxWindowState.Closed;
    }

    /// <summary>Valida una respuesta antes de encolarla. Devuelve el motivo para el usuario o null si es válida.</summary>
    public static string? ValidateReply(InboxReplyCheck reply, DateTime now, bool humanAgentEnabled, bool publicMediaAvailable)
    {
        var capability = For(reply.Platform, reply.Kind);
        string label = Platforms.Label(reply.Platform);
        if (capability.TextMax == 0) return $"{label} no permite responder a este tipo de conversación desde la app.";

        bool hasText = !string.IsNullOrWhiteSpace(reply.Body);
        if (reply.TemplateName is not null)
        {
            if (!capability.Templates) return $"{label} no usa plantillas.";
            return null;
        }

        if (!hasText && reply.MediaCount == 0) return "Escribe la respuesta o adjunta un archivo.";
        if (hasText && reply.Body!.Length > capability.TextMax) return $"{label} admite como mucho {capability.TextMax} caracteres por mensaje ({reply.Body.Length} ahora).";
        if (reply.MediaCount > 0 && !capability.Attachments) return $"En {label} solo se puede responder con texto aquí.";
        if (reply.MediaCount > 0 && capability.AttachmentsNeedPublicUrl && !publicMediaAvailable)
            return $"{label} descarga los adjuntos desde una dirección pública y este servidor no tiene una (App:PublicBaseUrl). Envía solo texto o configura la dirección pública.";
        if (reply.PrivateReply && !capability.PrivateReply) return $"{label} no admite respuestas privadas a comentarios.";
        if (reply.PrivateReply && reply.ParentExternalId is null) return "Elige el comentario al que quieres responder por privado.";

        if (!reply.PrivateReply && Window(reply.Platform, reply.Kind, reply.LastInboundAt, now, humanAgentEnabled) == InboxWindowState.Closed)
        {
            if (WindowNeverOpened(reply.Platform, reply.Kind, reply.LastInboundAt))
                return reply.Platform == Platforms.WhatsApp
                    ? "El cliente aún no ha escrito: WhatsApp solo deja empezar con una plantilla aprobada. Cuando conteste podrás escribirle libremente 24 h."
                    : $"La persona aún no ha escrito: {label} no deja escribirle primero.";
            return reply.Platform == Platforms.WhatsApp
                ? "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite enviar una plantilla aprobada."
                : $"Pasaron más de 24 h desde el último mensaje de la persona: {label} no deja responder hasta que vuelva a escribir.";
        }

        return null;
    }

    /// <summary>
    /// Teléfono en formato internacional: «+51 987-654-321» → «+51987654321». Null si no lo parece (hace falta el
    /// código de país: de 8 a 15 dígitos, según la norma E.164).
    /// </summary>
    public static string? NormalizePhone(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        string trimmed = value.Trim();
        if (trimmed.StartsWith("00", StringComparison.Ordinal)) trimmed = "+" + trimmed[2..];
        if (!trimmed.StartsWith('+')) return null;
        string digits = new(trimmed.Where(char.IsAsciiDigit).ToArray());
        bool onlySeparators = trimmed[1..].All(c => char.IsAsciiDigit(c) || c is ' ' or '-' or '.' or '(' or ')');
        return onlySeparators && digits.Length is >= 8 and <= 15 && digits[0] != '0' ? $"+{digits}" : null;
    }

    /// <summary>Lo que el compositor del front necesita para avisar mientras se escribe.</summary>
    public static InboxRulesInfo Describe(bool humanAgentEnabled, bool publicMediaAvailable) => new(
        Capabilities, WindowHours, humanAgentEnabled ? HumanAgentDays : null, publicMediaAvailable, YoutubeReplyUnits, NoteMax);
}

/// <param name="TextMax">0 = no se puede responder desde la app.</param>
/// <param name="WindowHours">Horas tras el último mensaje del cliente en las que se puede escribir texto libre (null = sin límite).</param>
/// <param name="QuotaUnits">Unidades de cuota que gasta cada respuesta (YouTube).</param>
public sealed record InboxCapability(
    int TextMax,
    int? WindowHours,
    bool Attachments,
    bool AttachmentsNeedPublicUrl,
    bool PrivateReply,
    bool Templates,
    int QuotaUnits = 0);

public enum InboxWindowState
{
    Open,
    /// <summary>Fuera de las 24 h pero dentro de 7 días: Messenger e Instagram con la etiqueta HUMAN_AGENT.</summary>
    HumanAgent,
    Closed
}

/// <summary>Lo que hace falta saber de una respuesta para validarla.</summary>
public sealed record InboxReplyCheck(
    string Platform,
    string Kind,
    DateTime? LastInboundAt,
    string? Body,
    int MediaCount,
    bool PrivateReply,
    string? ParentExternalId,
    string? TemplateName);

public sealed record InboxRulesInfo(
    IReadOnlyDictionary<string, InboxCapability> Capabilities,
    int WindowHours,
    int? HumanAgentDays,
    bool PublicMediaAvailable,
    int YoutubeReplyUnits,
    int NoteMax);
