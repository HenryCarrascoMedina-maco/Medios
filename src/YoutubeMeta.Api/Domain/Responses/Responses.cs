using System.Text.Json;
using System.Text.Json.Serialization;

namespace YoutubeMeta.Api.Domain.Responses;

public sealed class LoginResponse
{
    public string Token { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
}

#region VIDEOS
public sealed class VideoItem
{
    private static readonly JsonSerializerOptions SqlJson = new() { PropertyNameCaseInsensitive = true };

    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string OriginalFileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public decimal? DurationSec { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public string MediaKind { get; set; } = MediaKinds.Video;
    public bool HasPoster { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }

    public IReadOnlyList<string> Tags => string.IsNullOrEmpty(TagsCsv) ? [] : TagsCsv.Split(',');

    /// <summary>Última publicación de cada cuenta (sin las canceladas).</summary>
    public IReadOnlyList<VideoPublicationSummary> Publications =>
        string.IsNullOrEmpty(PublicationsJson) ? [] : JsonSerializer.Deserialize<List<VideoPublicationSummary>>(PublicationsJson, SqlJson) ?? [];

    [JsonIgnore] public string StoragePath { get; set; } = string.Empty;
    [JsonIgnore] public string? PublicationsJson { get; set; }
    [JsonIgnore] public string? TagsCsv { get; set; }
    [JsonIgnore] public int TotalCount { get; set; }
}

public sealed class VideoPublicationSummary
{
    public long PublicationId { get; set; }
    public int ConnectionId { get; set; }
    public string Target { get; set; } = string.Empty;
    public string ConnectionName { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public string StatusCode { get; set; } = string.Empty;
    public int? Percent { get; set; }
    public string? ExternalUrl { get; set; }
    public DateTimeOffset? PublishAt { get; set; }
}

public sealed class TicketResponse
{
    public string Url { get; set; } = string.Empty;
}

public sealed class PosterResponse
{
    public string PosterId { get; set; } = string.Empty;
}

public sealed class TusConfigResponse
{
    public int TtlMinutes { get; set; }
    public long MaxUploadBytes { get; set; }
    public string[] AllowedExtensions { get; set; } = [];
}
#endregion

#region PUBLICACIONES
public sealed class PublicationItem
{
    public long Id { get; set; }
    /// <summary>Medio principal (vacío en posts de solo texto o enlace).</summary>
    public int? VideoId { get; set; }
    public int PostId { get; set; }
    public string PostKind { get; set; } = PostKinds.Video;
    public int MediaCount { get; set; }
    /// <summary>Nombre del medio principal o, sin medio, el del post.</summary>
    public string VideoTitle { get; set; } = string.Empty;
    public string Target { get; set; } = string.Empty;
    public int ConnectionId { get; set; }
    public string ConnectionName { get; set; } = string.Empty;
    public string? ConnectionAvatarUrl { get; set; }
    public string Title { get; set; } = string.Empty;
    public string PrivacyStatus { get; set; } = string.Empty;
    public DateTimeOffset? PublishAt { get; set; }
    public string StatusCode { get; set; } = string.Empty;
    public int? Percent { get; set; }
    public long? BytesSent { get; set; }
    public long? TotalBytes { get; set; }
    public string? ExternalUrl { get; set; }
    public string? Warning { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
    public int Attempts { get; set; }
    public int MaxAttempts { get; set; }
    public DateTime? NextAttemptAt { get; set; }
    public bool IsSending { get; set; }
    /// <summary>Publicada, pero el primer comentario no se pudo poner: se ofrece «Reintentar comentario».</summary>
    public bool CommentPending { get; set; }
    public string RequestedBy { get; set; } = string.Empty;
    public DateTime RequestedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public long? Views { get; set; }
    public long? Likes { get; set; }
    public long? Comments { get; set; }
}

public sealed class PublicationEventItem
{
    public long Id { get; set; }
    public long PublicationId { get; set; }
    public string Target { get; set; } = string.Empty;
    public string StatusCode { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

/// <summary>Resultado por cuenta de un clic en Publicar: unas pueden entrar en cola y otras no.</summary>
public sealed class PublicationCreateResult
{
    public int ConnectionId { get; set; }
    public string AccountName { get; set; } = string.Empty;
    public long? PublicationId { get; set; }
    public string? Error { get; set; }
}

public sealed class NotificationItem
{
    public long Id { get; set; }
    public long PublicationId { get; set; }
    public int? VideoId { get; set; }
    public string VideoTitle { get; set; } = string.Empty;
    public string Target { get; set; } = string.Empty;
    public string ConnectionName { get; set; } = string.Empty;
    public string StatusCode { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; }
}
#endregion

#region CONEXIONES
public sealed class ConnectionItem
{
    public int Id { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string ExternalId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? Alias { get; set; }
    public string? AvatarUrl { get; set; }
    public string? AccountHint { get; set; }
    public string? Scopes { get; set; }
    public DateTime? TokenExpiresAt { get; set; }
    public string StatusCode { get; set; } = string.Empty;
    public string? StatusMessage { get; set; }
    public bool IsDefault { get; set; }
    public int? CredentialId { get; set; }
    public string? CredentialName { get; set; }
    /// <summary>Telegram: tamaño máximo que admite el servidor Bot API del bot.</summary>
    public int? UploadLimitMb { get; set; }
    public string ConnectedBy { get; set; } = string.Empty;
    public DateTime ConnectedAt { get; set; }
    public DateTime? LastUsedAt { get; set; }
    public DateTime? LastTestAt { get; set; }
    public bool? LastTestOk { get; set; }
    public string? LastTestMessage { get; set; }
    public DateTime? RevokedAt { get; set; }
    /// <summary>Firma de la cuenta ({firma_cuenta} en las plantillas).</summary>
    public string? Signature { get; set; }
}

public sealed class ConnectionsStatus
{
    public bool GoogleConfigured { get; set; }
    public string? GoogleRedirectUri { get; set; }
    public bool TiktokConfigured { get; set; }
    public string? TiktokRedirectUri { get; set; }
    public bool LinkedinConfigured { get; set; }
    public string? LinkedinRedirectUri { get; set; }
    public bool LinkedinOrgConfigured { get; set; }
    public string? LinkedinOrgRedirectUri { get; set; }
    public bool TeamsConfigured { get; set; }
    public string? TeamsRedirectUri { get; set; }
    public int TelegramBots { get; set; }
    public string GraphVersion { get; set; } = string.Empty;
    /// <summary>Cuentas conectadas o pendientes de reconexión, de todas las plataformas.</summary>
    public IEnumerable<ConnectionItem> Accounts { get; set; } = [];
    public IEnumerable<ConnectionItem> History { get; set; } = [];
}

public sealed class UrlResponse
{
    public string Url { get; set; } = string.Empty;
}

/// <summary>Página de Facebook o cuenta de Instagram a la que da acceso el token del usuario del sistema.</summary>
public sealed class MetaAccountOption
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Username { get; set; }
    public string? PictureUrl { get; set; }
    public string? Detail { get; set; }
    public bool CanPublish { get; set; }
    public string? Problem { get; set; }
    public bool AlreadyConnected { get; set; }
}

/// <summary>Resultado por cuenta al conectar varias de una vez (Páginas, cuentas de Instagram).</summary>
public sealed class AccountSaveResult
{
    public string Name { get; set; } = string.Empty;
    public int? ConnectionId { get; set; }
    public bool IsNew { get; set; }
    public string? Error { get; set; }
}

/// <summary>Equipos y canales de la cuenta que acaba de conectar Teams (para elegir dónde publicar).</summary>
public sealed class TeamsChannelsResponse
{
    public TeamsAccountInfo Account { get; set; } = new();
    public List<TeamsTeamOption> Teams { get; set; } = [];
}

public sealed class TeamsAccountInfo
{
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
}

public sealed class TeamsTeamOption
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public List<TeamsChannelOption> Channels { get; set; } = [];
}

public sealed class TeamsChannelOption
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    /// <summary>standard, private o shared.</summary>
    public string MembershipType { get; set; } = "standard";
    public bool Connected { get; set; }
}

public sealed class TelegramChatOption
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Username { get; set; }
    public string Type { get; set; } = string.Empty;
    public bool CanPost { get; set; }
    public string? Problem { get; set; }
    public bool AlreadyConnected { get; set; }
}

/// <summary>creator_info de TikTok: lo que el formulario debe ofrecer (privacidades, interacciones, duración).</summary>
public sealed class TiktokCreatorInfo
{
    public string Nickname { get; set; } = string.Empty;
    public string? Username { get; set; }
    public string? AvatarUrl { get; set; }
    public string[] PrivacyOptions { get; set; } = [];
    public bool CommentDisabled { get; set; }
    public bool DuetDisabled { get; set; }
    public bool StitchDisabled { get; set; }
    public int MaxDurationSec { get; set; }
}

public sealed class ConnectionTestResponse
{
    public bool IsOk { get; set; }
    public string Message { get; set; } = string.Empty;
}

public sealed class CategoryItem
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
}

public sealed class UsageResponse
{
    public DateTime DayPt { get; set; }
    public int Uploads { get; set; }
    public int UploadsLimit { get; set; }
    public int Units { get; set; }
    public int UnitsLimit { get; set; }
    public DateTime ResetsAtUtc { get; set; }
    /// <summary>Quién gastó la cuota de YouTube hoy. El límite es la suma de todos los canales.</summary>
    public IEnumerable<QuotaChannelRow> Channels { get; set; } = [];
    public string StorageRoot { get; set; } = string.Empty;
    public long StorageUsedBytes { get; set; }
    public long StorageFreeBytes { get; set; }
}

public sealed class QuotaRow
{
    public string Bucket { get; set; } = string.Empty;
    public int Units { get; set; }
}

public sealed class QuotaChannelRow
{
    public int ConnectionId { get; set; }
    public string DisplayName { get; set; } = string.Empty;
    public int Uploads { get; set; }
    public int Units { get; set; }
}
#endregion

#region AJUSTES
public sealed class CredentialItem
{
    public int Id { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? PublicId { get; set; }
    public CredentialSettings Options => CredentialSettings.Parse(Settings);
    public int InUse { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    [JsonIgnore] public string? Settings { get; set; }
}

/// <summary>Ajustes › Plataformas: qué clave se usa en cada plataforma y de dónde sale.</summary>
public sealed class PlatformSettingsResponse
{
    public CredentialSource Google { get; set; } = new();
    public CredentialSource Tiktok { get; set; } = new();
    public CredentialSource Linkedin { get; set; } = new();
    public CredentialSource LinkedinOrg { get; set; } = new();
    public CredentialSource Teams { get; set; } = new();
    /// <summary>App de Meta para los webhooks de la bandeja (Facebook, Instagram y WhatsApp).</summary>
    public CredentialSource MetaApp { get; set; } = new();
    public IEnumerable<CredentialItem> TelegramBots { get; set; } = [];
}

public sealed class CredentialSource
{
    /// <summary>DATABASE (guardada en Ajustes), CONFIG (user-secrets o variables de IIS) o NONE.</summary>
    public string Source { get; set; } = CredentialSources.None;
    public int? CredentialId { get; set; }
    public string? PublicId { get; set; }
    public string? RedirectUri { get; set; }
    public DateTime? UpdatedAt { get; set; }
    /// <summary>Solo Teams: inquilino de Microsoft Entra y caducidad del secreto.</summary>
    public string? TenantId { get; set; }
    public DateTime? SecretExpiresAt { get; set; }
    /// <summary>Solo la app de Meta: URL del webhook y texto de verificación que se pegan en Meta.</summary>
    public string? WebhookUrl { get; set; }
    public string? VerifyToken { get; set; }
}

public static class CredentialSources
{
    public const string Database = "DATABASE";
    public const string Config = "CONFIG";
    public const string None = "NONE";
}
#endregion
