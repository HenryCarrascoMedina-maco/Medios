namespace YoutubeMeta.Api.Domain.Entities;

public sealed class VideoRow
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string OriginalFileName { get; set; } = string.Empty;
    public string StoragePath { get; set; } = string.Empty;
    public string? PosterPath { get; set; }
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public decimal? DurationSec { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public string MediaKind { get; set; } = MediaKinds.Video;
}

/// <summary>Un archivo de un post, en su orden (MediaJson de la cola).</summary>
public sealed class PostMediaItem
{
    public int Id { get; set; }
    public string StoragePath { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public string MediaKind { get; set; } = MediaKinds.Video;
    public int? Width { get; set; }
    public int? Height { get; set; }
    public decimal? DurationSec { get; set; }
    public string? AltText { get; set; }

    /// <summary>Ruta absoluta en el servidor (la pone el job antes de subir).</summary>
    [System.Text.Json.Serialization.JsonIgnore]
    public string FullPath { get; set; } = string.Empty;

    /// <summary>Enlace firmado y temporal para las plataformas que descargan el archivo (null = sin App:PublicBaseUrl).</summary>
    [System.Text.Json.Serialization.JsonIgnore]
    public string? PublicUrl { get; set; }

    public static IReadOnlyList<PostMediaItem> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<List<PostMediaItem>>(json) ?? [];
        }
        catch (System.Text.Json.JsonException)
        {
            return [];
        }
    }
}

/// <summary>Lo común al post en las filas de la cola (subida y consulta).</summary>
public interface IPostContent
{
    long Id { get; }
    string Target { get; }
    string Title { get; }
    string? Description { get; }
    string PrivacyStatus { get; }
    string? Extra { get; }
    string PostKind { get; }
    string? LinkUrl { get; }
    IReadOnlyList<PostMediaItem> Media { get; }
}

public sealed class ConnectionRow
{
    public int Id { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string ConnectionKey { get; set; } = string.Empty;
    public string ExternalId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string StatusCode { get; set; } = string.Empty;
    public string? SecretCipher { get; set; }
    public int? CredentialId { get; set; }
    public DateTime? LastTestAt { get; set; }
    public string? Scopes { get; set; }
    /// <summary>JSON propio de la plataforma (<see cref="ConnectionExtra"/>).</summary>
    public string? Extra { get; set; }
}

public sealed class ConnectionSaved
{
    public int Id { get; set; }
    public bool IsNew { get; set; }
}

public sealed class ConnectionDeleted
{
    public string Platform { get; set; } = string.Empty;
    public string? SecretCipher { get; set; }
    public int? CredentialId { get; set; }
}

/// <summary>Clave de una plataforma (cliente OAuth o bot), con el secreto cifrado.</summary>
public sealed class CredentialRow
{
    public int Id { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? PublicId { get; set; }
    public string SecretCipher { get; set; } = string.Empty;
    public string? Settings { get; set; }
}

/// <summary>Fila de la cola reservada por el job (USP_BG_PUBLICATION_DUE_LIST).</summary>
public sealed class PublicationDueItem : IPostContent
{
    public long Id { get; set; }
    public int? VideoId { get; set; }
    public string Target { get; set; } = string.Empty;
    public int ConnectionId { get; set; }
    public string ConnectionKey { get; set; } = string.Empty;
    public int? CredentialId { get; set; }
    public string AccountExternalId { get; set; } = string.Empty;
    public string ConnectionStatus { get; set; } = string.Empty;
    /// <summary>Nombre de la cuenta (en Teams, «Equipo › Canal»).</summary>
    public string AccountName { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Tags { get; set; }
    public string? CategoryId { get; set; }
    public string PrivacyStatus { get; set; } = string.Empty;
    public DateTimeOffset? PublishAt { get; set; }
    public bool MadeForKids { get; set; }
    public bool ContainsSyntheticMedia { get; set; }
    public bool NotifySubscribers { get; set; }
    public string? Extra { get; set; }
    public string? SessionData { get; set; }
    /// <summary>Un intento anterior empezó el paso irreversible y no cerró: hay que comprobar antes de subir.</summary>
    public DateTime? CommitStartedAt { get; set; }
    public int Attempts { get; set; }
    public int MaxAttempts { get; set; }
    public int PostId { get; set; }
    public string PostKind { get; set; } = PostKinds.Video;
    public string? LinkUrl { get; set; }
    public string? MediaJson { get; set; }
    /// <summary>Medio principal (el video, la primera imagen o el PDF). Vacío en posts de solo texto.</summary>
    public string? StoragePath { get; set; }
    public string? PosterPath { get; set; }
    public string? ContentType { get; set; }
    public long SizeBytes { get; set; }
    public decimal? DurationSec { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }

    private IReadOnlyList<PostMediaItem>? _media;

    public IReadOnlyList<PostMediaItem> Media => _media ??= PostMediaItem.Parse(MediaJson);

    public PublicationOptions Options => PublicationOptions.Parse(Extra);
}

/// <summary>Fila en PROCESSING cuyo estado toca consultar (USP_BG_PUBLICATION_POLL_DUE_LIST).</summary>
public sealed class PublicationPollItem : IPostContent
{
    public long Id { get; set; }
    public int? VideoId { get; set; }
    public string Target { get; set; } = string.Empty;
    public int ConnectionId { get; set; }
    public string ConnectionKey { get; set; } = string.Empty;
    public int? CredentialId { get; set; }
    public string AccountExternalId { get; set; } = string.Empty;
    public string ConnectionStatus { get; set; } = string.Empty;
    public string ExternalId { get; set; } = string.Empty;
    public string? ExternalUrl { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string PrivacyStatus { get; set; } = string.Empty;
    public DateTimeOffset? PublishAt { get; set; }
    public string? Extra { get; set; }
    public string? SessionData { get; set; }
    public int PollCount { get; set; }
    public DateTime? UploadedAt { get; set; }
    public int Attempts { get; set; }
    public int MaxAttempts { get; set; }
    public int PostId { get; set; }
    public string PostKind { get; set; } = PostKinds.Video;
    public string? LinkUrl { get; set; }
    public string? MediaJson { get; set; }

    private IReadOnlyList<PostMediaItem>? _media;
    public IReadOnlyList<PostMediaItem> Media => _media ??= PostMediaItem.Parse(MediaJson);

    public PublicationOptions Options => PublicationOptions.Parse(Extra);
}

/// <summary>Publicación ya publicada a la que se le vuelve a poner el primer comentario (USP_PUBLICATION_COMMENT_GET).</summary>
public sealed class PublicationCommentRow
{
    public long Id { get; set; }
    public int? VideoId { get; set; }
    public string Target { get; set; } = string.Empty;
    public string StatusCode { get; set; } = string.Empty;
    public string? ExternalId { get; set; }
    public string? Extra { get; set; }
    public string? CommentExternalId { get; set; }
    public int ConnectionId { get; set; }
    public string ConnectionKey { get; set; } = string.Empty;
    public int? CredentialId { get; set; }
    public string AccountExternalId { get; set; } = string.Empty;
    public string ConnectionStatus { get; set; } = string.Empty;
}

/// <summary>Publicación cuyas métricas toca recoger (USP_BG_METRICS_DUE_LIST).</summary>
public sealed class MetricsDueItem
{
    public long Id { get; set; }
    public string Target { get; set; } = string.Empty;
    public string ExternalId { get; set; } = string.Empty;
    public int ConnectionId { get; set; }
    public string ConnectionKey { get; set; } = string.Empty;
    public string AccountExternalId { get; set; } = string.Empty;
}

/// <summary>Lo que devuelve una plataforma; null = no lo ofrece.</summary>
public sealed record PublicationMetrics(long? Views, long? Likes, long? Comments);

public sealed class PublicationResultRow
{
    public int Affected { get; set; }
    public int? VideoId { get; set; }
    public string Target { get; set; } = string.Empty;
    public string StatusCode { get; set; } = string.Empty;
}

/// <summary>Metadatos de una sesión TUS (metadata.json junto a upload.bin).</summary>
public sealed class TusVideoMetadata
{
    public string FileName { get; set; } = string.Empty;
    public string FileType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public decimal? DurationSec { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public string? PosterId { get; set; }
    public long UploadLength { get; set; }
    public string UserName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime LastActivityAt { get; set; }
    public bool IsCompleted { get; set; }
    public int? VideoId { get; set; }
    /// <summary>
    /// Destino elegido al empezar a finalizar (antes de mover el archivo). Si el proceso se recicla a mitad, la
    /// siguiente petición continúa con el archivo ya movido en vez de perderlo.
    /// </summary>
    public string? FinalPath { get; set; }
    public string? FinalPosterPath { get; set; }
}
