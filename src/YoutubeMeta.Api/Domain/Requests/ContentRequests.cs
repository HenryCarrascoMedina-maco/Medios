namespace YoutubeMeta.Api.Domain.Requests;

#region BIBLIOTECA
public sealed class VideoTagsRequest
{
    public List<int> VideoIds { get; set; } = [];
    public List<string> Add { get; set; } = [];
    public List<string> Remove { get; set; } = [];
}

public sealed class VideoIdsRequest
{
    public List<int> VideoIds { get; set; } = [];
}
#endregion

#region PLANTILLAS
/// <summary>Plantilla propia: de publicación (PUBLISH) o respuesta de la bandeja (REPLY, con /atajo).</summary>
public sealed class TemplateSaveRequest
{
    public string Usage { get; set; } = TemplateUsages.Publish;
    public string Name { get; set; } = string.Empty;
    /// <summary>Solo respuestas: se elige escribiendo /atajo.</summary>
    public string? Shortcut { get; set; }
    /// <summary>Solo publicaciones.</summary>
    public string? Title { get; set; }
    /// <summary>Texto con etiquetas ({titulo}, {nombre}, {?campo}, #bloque:x).</summary>
    public string? Body { get; set; }
    /// <summary>Etiquetas de YouTube (solo publicaciones).</summary>
    public string? Tags { get; set; }
    /// <summary>Redes donde se ofrece; vacía = en todas.</summary>
    public List<string> Platforms { get; set; } = [];
    public bool IsDefault { get; set; }
    /// <summary>Adjuntos de la biblioteca, en orden.</summary>
    public List<TemplateMediaRequest> Media { get; set; } = [];
}

public sealed class TemplateMediaRequest
{
    public int MediaId { get; set; }
    public string? Alt { get; set; }
}

public sealed class HashtagBlockSaveRequest
{
    public string Name { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
}

public sealed class SignatureRequest
{
    public string? Signature { get; set; }
}
#endregion

#region CALENDARIO Y RESULTADOS
public sealed class CalendarQuery
{
    public DateTime From { get; set; }
    public DateTime To { get; set; }
}

public sealed class RescheduleRequest
{
    /// <summary>Nueva fecha; vacío = en cuanto se pueda.</summary>
    public DateTimeOffset? PublishAt { get; set; }
}

public sealed class InsightsQuery
{
    /// <summary>Días hacia atrás (1-365).</summary>
    public int Days { get; set; } = 30;
}
#endregion
