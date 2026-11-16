namespace YoutubeMeta.Api.Application.Publishing;

/// <summary>
/// Lo que el job y Conexiones necesitan de cada plataforma. Añadir una plataforma = implementar esto (normalmente
/// heredando de <see cref="PlatformPublisherBase"/>) y registrarlo en DependencyInjection; el job, los reintentos
/// y los avisos no cambian.
/// </summary>
public interface IPlatformPublisher
{
    string Platform { get; }

    /// <summary>Filas por ciclo. Cada plataforma tiene su propio carril en el job, así que una subida larga solo frena la suya.</summary>
    int BatchSize { get; }

    /// <summary>Sube el archivo. Devuelve Processing (toca consultar) o Done si la plataforma publica en el acto.</summary>
    Task<PublishStep> UploadAsync(PublicationDueItem item, string filePath, string leaseOwner, UploadHeartbeat heartbeat);

    /// <summary>Consulta el procesamiento de algo ya subido.</summary>
    Task<PublishStep> PollAsync(PublicationPollItem item, CancellationToken cancellationToken);

    /// <summary>
    /// Un intento anterior llegó al paso irreversible y no terminó (corte de red o proceso caído). Comprueba en la
    /// plataforma si ya quedó publicado:
    /// <list type="bullet">
    /// <item>Processing/Done: ya está, no se vuelve a subir.</item>
    /// <item>null: seguro que no está; se sube de nuevo.</item>
    /// <item>NeedsReview: no se puede saber; decide una persona (con instrucciones).</item>
    /// </list>
    /// </summary>
    Task<PublishStep?> VerifyAsync(PublicationDueItem item, CancellationToken cancellationToken);

    /// <summary>Traduce una excepción no controlada de la plataforma a un paso del job.</summary>
    PublishStep Classify(Exception exception);

    /// <summary>Comprueba que el token de la cuenta sigue sirviendo (botón «Probar» y prueba periódica).</summary>
    Task<ConnectionTest> TestAsync(ConnectionRow connection, CancellationToken cancellationToken);
}

public sealed record ConnectionTest(bool IsOk, string Message);
