namespace YoutubeMeta.Api.Application.Publishing;

public enum PublishOutcome
{
    /// <summary>Subido; toca consultar el procesamiento.</summary>
    Processing,
    /// <summary>Procesado y publicado (o programado).</summary>
    Done,
    /// <summary>La plataforma sigue procesando: volver a consultar más tarde.</summary>
    StillProcessing,
    /// <summary>Error transitorio: reintentar con backoff (reanuda la sesión si existe).</summary>
    Retry,
    /// <summary>La sesión de subida (o el contenedor) ya no sirve: empezar desde cero.</summary>
    Restart,
    /// <summary>Cuota o límite diario: esperar, nunca insistir (cada intento también consume cuota).</summary>
    WaitQuota,
    NeedsReconnect,
    /// <summary>No se sabe si la plataforma lo publicó y no se pudo comprobar: decide una persona.</summary>
    NeedsReview,
    /// <summary>Requiere a una persona: no se reintenta solo.</summary>
    Failed,
    /// <summary>Otro proceso tomó la fila: no se escribe ningún resultado.</summary>
    LeaseLost
}

/// <summary>
/// Resultado de un paso del job contra una plataforma. Los mensajes los lee el usuario: dicen qué pasó y, si le
/// toca hacer algo, qué hacer.
/// </summary>
public sealed record PublishStep(
    PublishOutcome Outcome,
    string? ExternalId = null,
    string? ExternalUrl = null,
    string? Warning = null,
    string? ErrorCode = null,
    string? Message = null,
    DateTime? NextAttemptAt = null,
    string? CommentId = null)
{
    public static PublishStep Processing(string externalId, string? externalUrl, string? warning = null) =>
        new(PublishOutcome.Processing, externalId, externalUrl, warning);
    /// <param name="externalId">Id definitivo si cambia al publicar (Instagram: el media, no el contenedor).</param>
    public static PublishStep Done(string? externalUrl, string? warning = null, string? externalId = null) =>
        new(PublishOutcome.Done, ExternalId: externalId, ExternalUrl: externalUrl, Warning: warning);
    public static PublishStep StillProcessing() => new(PublishOutcome.StillProcessing);
    public static PublishStep Retry(string code, string message) => new(PublishOutcome.Retry, ErrorCode: code, Message: message);
    public static PublishStep Restart(string code, string message) => new(PublishOutcome.Restart, ErrorCode: code, Message: message);
    public static PublishStep WaitQuota(string code, string message, DateTime until) => new(PublishOutcome.WaitQuota, ErrorCode: code, Message: message, NextAttemptAt: until);
    public static PublishStep NeedsReconnect(string code, string message) => new(PublishOutcome.NeedsReconnect, ErrorCode: code, Message: message);
    public static PublishStep NeedsReview(string code, string message) => new(PublishOutcome.NeedsReview, ErrorCode: code, Message: message);
    public static PublishStep Failed(string code, string message) => new(PublishOutcome.Failed, ErrorCode: code, Message: message);
    public static PublishStep LeaseLost() => new(PublishOutcome.LeaseLost);

    /// <summary>Error de red o tiempo de espera agotado antes del paso irreversible: se puede reintentar sin riesgo.</summary>
    public static PublishStep Network(string platform) =>
        Retry("NETWORK", $"{platform} tardó demasiado en responder o se cortó la conexión. Se reintenta solo.");

    public static PublishStep NoToken(string account) =>
        NeedsReconnect("NO_TOKEN", $"{account} no tiene un acceso válido. Vuelve a conectarla en Conexiones.");
}
