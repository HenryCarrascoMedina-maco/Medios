namespace YoutubeMeta.Api.Domain.Requests;

public sealed class LoginRequest
{
    public string UserName { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public sealed class VideoListQuery
{
    public string? SearchTerm { get; set; }
    /// <summary>UNPUBLISHED, PUBLISHED, ERROR, SCHEDULED, ACTIVE o vacío.</summary>
    public string? Status { get; set; }
    public string? Platform { get; set; }
    public string? Tag { get; set; }
    /// <summary>VIDEO, IMAGE, DOCUMENT o vacío (todos).</summary>
    public string? Kind { get; set; }
    /// <summary>NEWEST (por defecto), OLDEST, TITLE, SIZE, DURATION.</summary>
    public string? Sort { get; set; }
    public int Offset { get; set; }
    /// <summary>Tamaño de página (1-200). Vacío en GET /api/Video = todos.</summary>
    public int? Take { get; set; }
}

public sealed class VideoTitleRequest
{
    public string Title { get; set; } = string.Empty;
}

#region PUBLICACIONES
/// <summary>
/// Un clic en Publicar: el mismo post a una o varias cuentas, con un único consentimiento. El tipo (texto, enlace,
/// imagen, carrusel, video, PDF) se deduce de <see cref="Media"/> y <see cref="LinkUrl"/>.
/// </summary>
public sealed class PublicationCreateRequest
{
    /// <summary>Compatibilidad: publicar un solo video (equivale a Media = [{ Id = VideoId }]).</summary>
    public int? VideoId { get; set; }
    /// <summary>Archivos de la biblioteca en el orden en que se publican (vacío = post de texto o de enlace).</summary>
    public List<PostMediaInput> Media { get; set; } = [];
    /// <summary>Enlace con vista previa (solo en posts sin archivos).</summary>
    public string? LinkUrl { get; set; }
    /// <summary>Nombre interno del post (biblioteca y calendario). Vacío = el título del primer destino.</summary>
    public string? Title { get; set; }
    public bool Consent { get; set; }
    public List<PublicationDestination> Destinations { get; set; } = [];
}

public sealed class PostMediaInput
{
    public int Id { get; set; }
    /// <summary>Texto alternativo (accesibilidad). Lo usan LinkedIn y Facebook.</summary>
    public string? Alt { get; set; }
}

/// <summary>Lo que se publica en una cuenta. Cada plataforma usa solo los campos que le aplican.</summary>
public sealed class PublicationDestination
{
    public int ConnectionId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Tags { get; set; }
    public string? CategoryId { get; set; }
    public string? PrivacyStatus { get; set; }
    public DateTimeOffset? PublishAt { get; set; }
    public bool? MadeForKids { get; set; }
    public bool? ContainsSyntheticMedia { get; set; }
    public bool NotifySubscribers { get; set; } = true;
    public PublicationOptions? Options { get; set; }
}

/// <summary>Opciones propias de cada plataforma; se guardan como JSON en Video_Publications.Extra.</summary>
public sealed class PublicationOptions
{
    // YouTube: lista de reproducción donde se añade el video al subirlo (opcional).
    public string? PlaylistId { get; set; }

    // Facebook, Instagram y LinkedIn: comentario de la propia cuenta justo después de publicar (p. ej. los hashtags).
    public string? FirstComment { get; set; }

    // Instagram
    public bool? ShareToFeed { get; set; }

    // Telegram
    public bool? DisableNotification { get; set; }
    public bool? ProtectContent { get; set; }

    // Teams (Graph): menciona al canal (@canal) para que avise a todos sus miembros.
    public bool? TeamsMentionChannel { get; set; }

    // TikTok: DIRECT publica en el perfil; INBOX deja un borrador en la app para terminarlo allí.
    public string? TiktokMode { get; set; }
    public bool? DisableComment { get; set; }
    public bool? DisableDuet { get; set; }
    public bool? DisableStitch { get; set; }
    public bool? BrandContent { get; set; }
    public bool? BrandOrganic { get; set; }
    public bool? IsAigc { get; set; }

    [System.Text.Json.Serialization.JsonIgnore]
    public bool IsTiktokInbox => string.Equals(TiktokMode, TiktokModes.Inbox, StringComparison.OrdinalIgnoreCase);

    public string? ToJson() => JsonColumn.Serialize(this);

    public static PublicationOptions Parse(string? json) => JsonColumn.Parse<PublicationOptions>(json);
}

public static class TiktokModes
{
    public const string Direct = "DIRECT";
    public const string Inbox = "INBOX";
}

public sealed class PublicationListQuery
{
    public int? VideoId { get; set; }
    /// <summary>ACTIVE, DONE, ERROR, WAITING o vacío (todas).</summary>
    public string? Group { get; set; }
    public string? Platform { get; set; }
    public int? ConnectionId { get; set; }
    /// <summary>Texto en el título del video o de la publicación, o en el nombre de la cuenta.</summary>
    public string? SearchTerm { get; set; }
    /// <summary>Pedidas desde / hasta (UTC).</summary>
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
}

public sealed class PublicationResolveRequest
{
    /// <summary>MARK_DONE (ya está publicado) o REUPLOAD (subir de nuevo).</summary>
    public string Action { get; set; } = string.Empty;
    /// <summary>Opcional con MARK_DONE: enlace al video en la plataforma.</summary>
    public string? ExternalUrl { get; set; }
}
#endregion

#region CONEXIONES
public sealed class OAuthConnectQuery
{
    public string? ReturnUrl { get; set; }
    /// <summary>Teams: pedir también permiso para leer las respuestas (bandeja; lo aprueba un administrador).</summary>
    public bool Inbox { get; set; }
}

public sealed class OAuthCallbackQuery
{
    public string? Code { get; set; }
    public string? State { get; set; }
    public string? Error { get; set; }
    /// <summary>Microsoft Entra explica el error aquí (códigos AADSTS…).</summary>
    [FromQuery(Name = "error_description")]
    public string? ErrorDescription { get; set; }
}

public sealed class ConnectionAliasRequest
{
    public string? Alias { get; set; }
}

/// <summary>Token del usuario del sistema de Meta: sirve para Facebook y para Instagram.</summary>
public sealed class MetaTokenRequest
{
    public string SystemUserToken { get; set; } = string.Empty;
}

public sealed class MetaAccountsSaveRequest
{
    public string SystemUserToken { get; set; } = string.Empty;
    public List<string> AccountIds { get; set; } = [];
}

public sealed class TelegramChatsRequest
{
    public int CredentialId { get; set; }
}

public sealed class TelegramChannelSaveRequest
{
    public int CredentialId { get; set; }
    /// <summary>@usuario del canal o su id numérico (-100…).</summary>
    public string Chat { get; set; } = string.Empty;
}
#endregion

#region AJUSTES
/// <summary>
/// Alta o cambio de una clave. Google y TikTok: PublicId = Client ID / client_key, Secret = secreto.
/// Meta: PublicId = App ID, Secret = App Secret (firma de los webhooks de la bandeja).
/// Telegram: Secret = token del bot (el id y el nombre se leen con getMe).
/// Secret vacío al editar = conservar el guardado.
/// </summary>
public sealed class CredentialSaveRequest
{
    public int? Id { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string? PublicId { get; set; }
    public string? Secret { get; set; }
    public string? ApiBaseUrl { get; set; }
    public int? MaxUploadMb { get; set; }
    /// <summary>Teams: Id. de directorio (inquilino) de Microsoft Entra.</summary>
    public string? TenantId { get; set; }
    /// <summary>Teams: fecha en que caduca el secreto (la app avisa un mes antes).</summary>
    public DateTime? SecretExpiresAt { get; set; }
}

public sealed class TeamsChannelsSaveRequest
{
    public string Pick { get; set; } = string.Empty;
    public List<TeamsChannelRef> Channels { get; set; } = [];
}

public sealed class TeamsChannelRef
{
    public string TeamId { get; set; } = string.Empty;
    public string ChannelId { get; set; } = string.Empty;
}

public sealed class TeamsWebhookSaveRequest
{
    public string Name { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
}
#endregion
