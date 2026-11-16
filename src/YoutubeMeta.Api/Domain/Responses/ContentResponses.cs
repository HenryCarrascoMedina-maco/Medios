using System.Text.Json.Serialization;

namespace YoutubeMeta.Api.Domain.Responses;

#region BIBLIOTECA
public sealed class VideoPage
{
    public IReadOnlyList<VideoItem> Items { get; set; } = [];
    public int Total { get; set; }
}

public sealed class TagItem
{
    public string Tag { get; set; } = string.Empty;
    public int VideoCount { get; set; }
}

public sealed class BulkResult
{
    public int Done { get; set; }
    public List<string> Errors { get; set; } = [];
}
#endregion

#region PLANTILLAS
/// <summary>Plantilla propia (USP_TEMPLATE_LIST) con sus adjuntos.</summary>
public sealed class TemplateItem
{
    public int Id { get; set; }
    public string Usage { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Shortcut { get; set; }
    public string? Title { get; set; }
    public string? Body { get; set; }
    public string? Tags { get; set; }
    [JsonIgnore] public string? Platforms { get; set; }
    public bool IsDefault { get; set; }
    public int UseCount { get; set; }
    public DateTime? LastUsedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public IReadOnlyList<TemplateMediaItem> Media { get; set; } = [];

    /// <summary>Redes donde se ofrece; vacía = en todas.</summary>
    [JsonPropertyName("platforms")]
    public string[] PlatformList => string.IsNullOrEmpty(Platforms) ? [] : Platforms.Split(',');
}

/// <summary>Adjunto de una plantilla con lo que el front necesita para mostrarlo como un medio de la biblioteca.</summary>
public sealed class TemplateMediaItem
{
    [JsonIgnore] public int TemplateId { get; set; }
    public int Position { get; set; }
    public int MediaId { get; set; }
    public string? AltText { get; set; }
    public string Title { get; set; } = string.Empty;
    public string OriginalFileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public decimal? DurationSec { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public string MediaKind { get; set; } = string.Empty;
    public bool HasPoster { get; set; }
    /// <summary>Se borró de la biblioteca: la plantilla lo avisa y al usarla se omite.</summary>
    public bool Missing { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public sealed class HashtagBlockItem
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; }
}

public sealed class PlaylistOption
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public long? ItemCount { get; set; }
}
#endregion

#region CALENDARIO
public sealed class CalendarItem
{
    public long Id { get; set; }
    public int? VideoId { get; set; }
    public int PostId { get; set; }
    public string PostKind { get; set; } = PostKinds.Video;
    public string VideoTitle { get; set; } = string.Empty;
    public bool HasPoster { get; set; }
    public string Target { get; set; } = string.Empty;
    public int ConnectionId { get; set; }
    public string ConnectionName { get; set; } = string.Empty;
    public string? ConnectionAvatarUrl { get; set; }
    public string Title { get; set; } = string.Empty;
    public string StatusCode { get; set; } = string.Empty;
    public DateTimeOffset? PublishAt { get; set; }
    /// <summary>Fecha que se pinta (UTC): la programada o la de publicación.</summary>
    public DateTime When { get; set; }
    public string? ExternalUrl { get; set; }
    public bool CanReschedule { get; set; }
}
#endregion

#region RESULTADOS Y SALUD
public sealed class InsightsDay
{
    public DateTime Day { get; set; }
    public int Done { get; set; }
    public int Failed { get; set; }
}

public sealed class InsightsAccount
{
    public int ConnectionId { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string ConnectionName { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public int Published { get; set; }
    public int Failed { get; set; }
    public long? Views { get; set; }
    public long? Likes { get; set; }
    public long? Comments { get; set; }
    public double? AvgMinutes { get; set; }
}

public sealed class InsightsResponse
{
    public int Days { get; set; }
    public int Published { get; set; }
    public int Failed { get; set; }
    /// <summary>0-100; null si no hubo publicaciones cerradas.</summary>
    public double? SuccessRate { get; set; }
    public long Views { get; set; }
    public long Likes { get; set; }
    public long Comments { get; set; }
    public double? AvgMinutes { get; set; }
    public IReadOnlyList<InsightsDay> Daily { get; set; } = [];
    public IReadOnlyList<InsightsAccount> Accounts { get; set; } = [];
    /// <summary>Mensajes recibidos y respondidos en la bandeja en el mismo periodo.</summary>
    public InboxStats Inbox { get; set; } = new();
}

/// <summary>Fila de USP_SYSTEM_HEALTH.</summary>
public sealed class QueueHealth
{
    public int QueueDue { get; set; }
    public int Processing { get; set; }
    public int Scheduled { get; set; }
    public int? OldestDueMinutes { get; set; }
    public int StuckUploads { get; set; }
    public int NeedsReview { get; set; }
    public int FailedLast7Days { get; set; }
    public int ConnectionsNeedingReconnect { get; set; }
    public int TokensExpiringSoon { get; set; }
    public int ConnectionsFailingTest { get; set; }
    public int InboxEventsFailed { get; set; }
    public int InboxSendProblems { get; set; }
    public int InboxSyncErrors { get; set; }
}

public sealed class SystemHealthResponse
{
    /// <summary>ok, warn o error: el peor de los indicadores.</summary>
    public string Status { get; set; } = "ok";
    public QueueHealth Queue { get; set; } = new();
    public int YoutubeUploadsUsed { get; set; }
    public int YoutubeUploadsLimit { get; set; }
    public int YoutubeUnitsUsed { get; set; }
    public int YoutubeUnitsLimit { get; set; }
    public long StorageUsedBytes { get; set; }
    public long StorageFreeBytes { get; set; }
    /// <summary>Carril del job → última vuelta completada (UTC).</summary>
    public IReadOnlyDictionary<string, DateTime> JobLanes { get; set; } = new Dictionary<string, DateTime>();
    /// <summary>Qué mirar, en frases para el usuario.</summary>
    public List<string> Alerts { get; set; } = [];
}
#endregion
