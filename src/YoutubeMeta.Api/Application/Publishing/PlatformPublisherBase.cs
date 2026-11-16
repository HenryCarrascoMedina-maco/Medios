using System.Text.Json;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Application.Publishing;

/// <summary>
/// Lo común a todas las plataformas: tamaño de lote, sesión de subida cifrada, token de la cuenta, errores
/// inesperados y la verificación por defecto de un resultado dudoso.
/// </summary>
public abstract class PlatformPublisherBase(PublisherServices services) : IPlatformPublisher
{
    protected PublisherServices Services { get; } = services;

    public abstract string Platform { get; }

    protected string Label => Platforms.Label(Platform);

    public virtual int BatchSize => Math.Max(Services.Settings.PlatformBatch, 1);

    public abstract Task<PublishStep> UploadAsync(PublicationDueItem item, string filePath, string leaseOwner, UploadHeartbeat heartbeat);

    public abstract Task<PublishStep> PollAsync(PublicationPollItem item, CancellationToken cancellationToken);

    public abstract Task<ConnectionTest> TestAsync(ConnectionRow connection, CancellationToken cancellationToken);

    /// <summary>Por defecto no hay forma de comprobarlo: se pide a una persona que lo mire.</summary>
    public virtual Task<PublishStep?> VerifyAsync(PublicationDueItem item, CancellationToken cancellationToken) =>
        Task.FromResult<PublishStep?>(UnverifiableStep());

    /// <summary>Lo no previsto se reintenta (con tope). El detalle técnico va al registro, no al usuario.</summary>
    public virtual PublishStep Classify(Exception exception) =>
        PublishStep.Retry("UNEXPECTED", $"Error inesperado al publicar en {Label} ({exception.GetType().Name}). Se reintenta solo.");

    protected PublishStep UnverifiableStep() => Unverifiable(Label);

    public static PublishStep Unverifiable(string label) => PublishStep.NeedsReview("UNCERTAIN",
        $"Se cortó la comunicación justo cuando {label} recibía la publicación y no se puede comprobar si la publicó. " +
        $"Revisa la cuenta en {label}: si ya aparece, pulsa «Ya está publicado»; si no, pulsa «Publicar de nuevo».");

    protected PublishStep NoTokenStep(string account) => PublishStep.NoToken(account);

    /// <summary>Texto de una publicación de texto libre: la descripción o, si está vacía, el título.</summary>
    protected static string PostText(IPostContent item) => string.IsNullOrWhiteSpace(item.Description) ? item.Title : item.Description!;

    /// <summary>Desde cuándo buscar una publicación dudosa: 5 min antes de empezar a enviarla (1 h atrás si no consta).</summary>
    protected static DateTimeOffset VerifySince(PublicationDueItem item) =>
        new DateTimeOffset(item.CommitStartedAt ?? DateTime.UtcNow.AddHours(-1), TimeSpan.Zero).AddMinutes(-5);

    protected Task<string?> TokenAsync(string connectionKey, CancellationToken cancellationToken) =>
        Services.TokenAsync(connectionKey, cancellationToken);

    protected T? ReadSession<T>(string? cipher) where T : class => Services.ReadSession<T>(cipher);

    protected Task SaveSessionAsync<T>(PublicationDueItem item, string leaseOwner, T session, CancellationToken cancellationToken) =>
        Services.SaveSessionAsync(item, leaseOwner, session, cancellationToken);
}

/// <summary>Dependencias que comparten todos los publicadores (una sola inyección en lugar de cinco listas iguales).</summary>
public sealed class PublisherServices(
    PublicationRepository publications,
    ConnectionRepository connections,
    SecretProtector protector,
    IOptions<VideoPublishSettings> settings)
{
    public PublicationRepository Publications { get; } = publications;
    public ConnectionRepository Connections { get; } = connections;
    public SecretProtector Protector { get; } = protector;
    public VideoPublishSettings Settings { get; } = settings.Value;

    public async Task<string?> TokenAsync(string connectionKey, CancellationToken cancellationToken) =>
        Protector.UnprotectOrNull(await Connections.TokenGet(connectionKey, cancellationToken));

    public T? ReadSession<T>(string? cipher) where T : class
    {
        string? json = Protector.UnprotectOrNull(cipher);
        if (json is null) return null;
        try
        {
            return JsonSerializer.Deserialize<T>(json);
        }
        catch (JsonException)
        {
            // Sesión de otra versión o dañada: se empieza de cero.
            return null;
        }
    }

    public Task SaveSessionAsync<T>(PublicationDueItem item, string leaseOwner, T session, CancellationToken cancellationToken) =>
        Publications.SessionSave(item.Id, leaseOwner, Protector.Protect(JsonSerializer.Serialize(session)), cancellationToken);
}
