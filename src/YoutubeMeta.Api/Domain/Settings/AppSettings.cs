namespace YoutubeMeta.Api.Domain.Settings;

public sealed class AppSettings
{
    /// <summary>Dirección del front a la que vuelve el OAuth. Vacío = mismo origen que la API (IIS).</summary>
    public string FrontBaseUrl { get; set; } = string.Empty;

    /// <summary>Redirige a https y envía HSTS. Activar solo si el sitio tiene certificado (producción).</summary>
    public bool ForceHttps { get; set; }

    /// <summary>
    /// Dirección pública de la API (https://midominio.com). Instagram y TikTok descargan las imágenes desde aquí con
    /// enlaces firmados de 1 h; LinkedIn la usa para su URL de retorno si no se configura otra. Vacío = en local.
    /// </summary>
    public string PublicBaseUrl { get; set; } = string.Empty;

    public bool HasPublicBaseUrl => Uri.TryCreate(PublicBaseUrl, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps;
}

public sealed class AuthSettings
{
    public string AdminUser { get; set; } = "admin";
    public string AdminDisplayName { get; set; } = "Administrador";
    public string AdminPasswordHash { get; set; } = string.Empty;
    public string JwtKey { get; set; } = string.Empty;
    public string JwtIssuer { get; set; } = "YoutubeMeta";
    public int TokenHours { get; set; } = 12;
}

public sealed class SecuritySettings
{
    public string SecretKey { get; set; } = string.Empty;
}

public sealed class StorageSettings
{
    public string Root { get; set; } = "storage";
    public int MaxUploadGb { get; set; } = 20;
    public int TusTtlMinutes { get; set; } = 1440;
    public int StreamChunkMb { get; set; } = 10;
    public int StreamTicketMinutes { get; set; } = 30;
    /// <summary>Sin valor inicial: el binder de configuración AÑADE a un arreglo ya inicializado.</summary>
    public string[] AllowedExtensions { get; set; } = [];

    public string[] Extensions => AllowedExtensions.Length > 0 ? AllowedExtensions : ["mp4", "mov", "m4v", "webm", "mkv", "avi"];

    /// <summary>Imágenes y documentos que admite la biblioteca (las plataformas aceptan JPEG y PNG; documentos, PDF).</summary>
    public static readonly string[] ImageExtensions = ["jpg", "jpeg", "png"];
    public static readonly string[] DocumentExtensions = ["pdf"];

    /// <summary>Todo lo que se puede subir a la biblioteca.</summary>
    public string[] AllExtensions => [.. Extensions, .. ImageExtensions, .. DocumentExtensions];

    public static string KindOf(string extension) =>
        ImageExtensions.Contains(extension, StringComparer.OrdinalIgnoreCase) ? MediaKinds.Image
        : DocumentExtensions.Contains(extension, StringComparer.OrdinalIgnoreCase) ? MediaKinds.Document
        : MediaKinds.Video;

    public long MaxUploadBytes => MaxUploadGb * 1024L * 1024L * 1024L;
}

public sealed class GoogleSettings
{
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
    public string RedirectUri { get; set; } = string.Empty;
    public string RegionCode { get; set; } = "EC";
    public string ApplicationName { get; set; } = "YoutubeMeta";

    public bool IsConfigured => ClientId.Length > 0 && ClientSecret.Length > 0 && RedirectUri.Length > 0;
}

public sealed class MetaSettings
{
    public string GraphVersion { get; set; } = "v26.0";
    public int ChunkMb { get; set; } = 8;
    /// <summary>App de Meta para los webhooks de la bandeja. Lo guardado en Ajustes tiene prioridad.</summary>
    public string AppId { get; set; } = string.Empty;
    public string AppSecret { get; set; } = string.Empty;
    public string WebhookVerifyToken { get; set; } = string.Empty;
}

/// <summary>Credenciales efectivas de la app de Meta (bandeja): App Secret para la firma y texto de verificación.</summary>
public sealed class MetaAppKeys
{
    public string AppId { get; set; } = string.Empty;
    public string AppSecret { get; set; } = string.Empty;
    public string VerifyToken { get; set; } = string.Empty;

    public bool IsConfigured => AppId.Length > 0 && AppSecret.Length > 0 && VerifyToken.Length > 0;
}

/// <summary>Cliente de TikTok for Developers. Lo guardado en Ajustes tiene prioridad sobre estos valores.</summary>
public sealed class TiktokSettings
{
    public string ClientKey { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
    /// <summary>TikTok solo admite https: en local hace falta un túnel (ver la guía).</summary>
    public string RedirectUri { get; set; } = string.Empty;
    public int ChunkMb { get; set; } = 32;

    public bool IsConfigured => ClientKey.Length > 0 && ClientSecret.Length > 0 && RedirectUri.Length > 0;
}

/// <summary>
/// Apps de LinkedIn: una para perfiles personales («Share on LinkedIn» + «Sign In with LinkedIn using OpenID Connect»)
/// y otra, opcional, para páginas de empresa (Community Management API, la aprueba LinkedIn). Lo guardado en Ajustes
/// tiene prioridad sobre estos valores.
/// </summary>
public sealed class LinkedinSettings
{
    public const string DefaultApiVersion = "202610";

    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
    /// <summary>Vacío = {App:PublicBaseUrl}/api/Connection/Linkedin/Callback.</summary>
    public string RedirectUri { get; set; } = string.Empty;

    public string OrgClientId { get; set; } = string.Empty;
    public string OrgClientSecret { get; set; } = string.Empty;
    /// <summary>Vacío = {App:PublicBaseUrl}/api/Connection/LinkedinOrg/Callback.</summary>
    public string OrgRedirectUri { get; set; } = string.Empty;

    /// <summary>
    /// Versión de la API (cabecera LinkedIn-Version, AAAAMM). LinkedIn retira cada versión al cabo de un año
    /// aproximadamente: la salud del sistema avisa cuando la configurada tiene más de 10 meses.
    /// </summary>
    public string ApiVersion { get; set; } = DefaultApiVersion;

    /// <summary>Minutos que el job espera a que LinkedIn procese un video o PDF; después reintenta sin volver a subirlo.</summary>
    public int MaxVideoWaitMinutes { get; set; } = 15;
}

/// <summary>Credenciales efectivas de UNA app de LinkedIn (perfil o empresa).</summary>
public sealed class LinkedinApp
{
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
    public string RedirectUri { get; set; } = string.Empty;
    public string ApiVersion { get; set; } = LinkedinSettings.DefaultApiVersion;
    public bool IsOrganization { get; set; }

    public bool IsConfigured => ClientId.Length > 0 && ClientSecret.Length > 0 && RedirectUri.Length > 0;
}

/// <summary>App de Microsoft Entra para publicar en canales de Teams. Lo guardado en Ajustes tiene prioridad.</summary>
public sealed class TeamsSettings
{
    public string TenantId { get; set; } = string.Empty;
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
    /// <summary>Vacío = {App:PublicBaseUrl}/api/Connection/Teams/Callback.</summary>
    public string RedirectUri { get; set; } = string.Empty;
    public DateTime? SecretExpiresAt { get; set; }

    public bool IsConfigured => TenantId.Length > 0 && ClientId.Length > 0 && ClientSecret.Length > 0 && RedirectUri.Length > 0;
}

/// <summary>
/// Plataformas apagadas en esta instalación (Platforms:Disabled, p. ej. ["LINKEDIN"]): no aparecen en la app, no
/// publican ni se prueban, y lo pendiente se cancela con el motivo. El código, las tablas y los tokens se conservan:
/// para volver a activarla basta con quitarla de la lista.
/// </summary>
public sealed class PlatformsSettings
{
    /// <summary>Sin valor inicial: el binder de configuración AÑADE a un arreglo ya inicializado.</summary>
    public string[] Disabled { get; set; } = [];

    public bool IsEnabled(string platform) => !Disabled.Contains(platform, StringComparer.OrdinalIgnoreCase);

    /// <summary>Las que publican (carriles del job, destinos al publicar).</summary>
    public IReadOnlyList<string> Publishable => Platforms.All.Where(IsEnabled).ToList();

    /// <summary>Las que se pueden conectar (incluye WhatsApp, que solo es de la bandeja).</summary>
    public IReadOnlyList<string> Connectable => Platforms.Connectable.Where(IsEnabled).ToList();
}

public sealed class TelegramSettings
{
    public const string CloudApiBaseUrl = "https://api.telegram.org";
    public const int CloudMaxUploadMb = 50;
    public const int LocalMaxUploadMb = 2000;
}

/// <summary>Platform_Credentials.Settings (JSON): Telegram (servidor Bot API propio), Teams y la app de Meta.</summary>
public sealed class CredentialSettings
{
    public string? ApiBaseUrl { get; set; }
    public int? MaxUploadMb { get; set; }
    /// <summary>Teams: inquilino de Entra y caducidad del secreto.</summary>
    public string? TenantId { get; set; }
    public DateTime? SecretExpiresAt { get; set; }
    /// <summary>App de Meta: texto que Meta repite al verificar la URL del webhook (lo genera la app al guardar).</summary>
    public string? VerifyToken { get; set; }

    [System.Text.Json.Serialization.JsonIgnore]
    public string TelegramBaseUrl => string.IsNullOrWhiteSpace(ApiBaseUrl) ? TelegramSettings.CloudApiBaseUrl : ApiBaseUrl.TrimEnd('/');

    [System.Text.Json.Serialization.JsonIgnore]
    public int TelegramMaxUploadMb => MaxUploadMb ?? TelegramSettings.CloudMaxUploadMb;

    public string? ToJson() => JsonColumn.Serialize(this);

    public static CredentialSettings Parse(string? json) => JsonColumn.Parse<CredentialSettings>(json);
}

public sealed class VideoPublishSettings
{
    public bool Enabled { get; set; } = true;
    public bool RunOnStartup { get; set; } = true;
    public int DelaySeconds { get; set; } = 30;
    public int LeaseMinutes { get; set; } = 10;
    public int YoutubeChunkMb { get; set; } = 32;
    /// <summary>Filas por ciclo en cada plataforma (YouTube va siempre de una en una).</summary>
    public int PlatformBatch { get; set; } = 3;
    public int PollBatch { get; set; } = 20;
    public int BackoffMinutes { get; set; } = 5;
    public int ProgressEverySeconds { get; set; } = 15;
    public int PollMaxHours { get; set; } = 24;
}

public sealed class StorageCleanupSettings
{
    public bool Enabled { get; set; } = true;
    public int DelayMinutes { get; set; } = 60;
    public int TempPosterHours { get; set; } = 24;
    /// <summary>Días que se guarda el historial de publicaciones ya cerradas (los avisos sin leer no se borran).</summary>
    public int EventRetentionDays { get; set; } = 365;
}

public sealed class TokenKeepAliveSettings
{
    public bool Enabled { get; set; } = true;
    /// <summary>Cada cuenta se prueba si lleva más de estas horas sin probarse (se revisa cada hora).</summary>
    public int DelayHours { get; set; } = 168;
}

public sealed class MetricsSettings
{
    public bool Enabled { get; set; } = true;
    /// <summary>Cada cuánto se revisa (cada publicación se actualiza como mucho una vez cada 20 h).</summary>
    public int DelayMinutes { get; set; } = 60;
    /// <summary>Publicaciones por vuelta (YouTube: 1 unidad de cuota cada una).</summary>
    public int Batch { get; set; } = 100;
}

/// <summary>
/// Bandeja unificada (Jobs:Inbox). Los webhooks llegan al instante; lo que se consulta (YouTube, Telegram sin URL
/// pública, Teams) va a su ritmo para no gastar cuota.
/// </summary>
public sealed class InboxSettings
{
    public bool Enabled { get; set; } = true;
    /// <summary>Ritmo de los carriles de entrada y de envío.</summary>
    public int DelaySeconds { get; set; } = 5;
    public int Batch { get; set; } = 20;
    public int LeaseMinutes { get; set; } = 5;
    public int MaxAttempts { get; set; } = 5;
    public int BackoffSeconds { get; set; } = 30;
    /// <summary>Comentarios de YouTube: cada página cuesta 1 unidad del cupo diario de 10 000 que comparten las subidas.</summary>
    public int YoutubePollMinutes { get; set; } = 10;
    public int TeamsPollMinutes { get; set; } = 5;
    /// <summary>Telegram sin URL pública (desarrollo): getUpdates cada estos segundos.</summary>
    public int TelegramPollSeconds { get; set; } = 15;
    /// <summary>Días hacia atrás que se leen las respuestas de las publicaciones de Teams.</summary>
    public int TeamsThreadDays { get; set; } = 14;
    public int EventRetentionDays { get; set; } = 30;
    /// <summary>
    /// Messenger e Instagram: responder entre 24 h y 7 días con la etiqueta HUMAN_AGENT. Activar solo cuando Meta
    /// haya aprobado ese permiso para la app (ver la guía); sin él, Meta rechaza el envío.
    /// </summary>
    public bool MetaHumanAgentTag { get; set; }
    /// <summary>Meses que se guardan los mensajes (son datos personales de terceros).</summary>
    public int MessageRetentionMonths { get; set; } = 12;
    /// <summary>Días que vale un enlace de invitación (Telegram, Messenger, Instagram). Es de un solo uso.</summary>
    public int InviteDays { get; set; } = 30;
    /// <summary>
    /// Guardar una copia de los archivos recibidos en el almacenamiento propio: las redes los caducan (WhatsApp en
    /// semanas, los enlaces de Messenger e Instagram antes). Se borran con la misma retención que los mensajes.
    /// </summary>
    public bool KeepReceivedFiles { get; set; } = true;
    /// <summary>Tamaño máximo de cada archivo que se copia (MB); los más grandes se siguen abriendo desde la red.</summary>
    public int KeepFileMaxMb { get; set; } = 50;
}

/// <summary>Social_Connections.Extra (JSON): datos propios de la plataforma.</summary>
public sealed class ConnectionExtra
{
    /// <summary>WhatsApp: cuenta de WhatsApp Business (WABA) del número; de ahí salen las plantillas.</summary>
    public string? WabaId { get; set; }

    /// <summary>Teams: id del usuario de Microsoft que conectó el canal (sus respuestas son las propias en la bandeja).</summary>
    public string? UserId { get; set; }

    public string? ToJson() => JsonColumn.Serialize(this);

    public static ConnectionExtra Parse(string? json) => JsonColumn.Parse<ConnectionExtra>(json);
}
