using System.Text.Json;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Application.Inbox;

/// <summary>
/// Lo común a todas las plataformas de la bandeja: token de la cuenta, cuenta de un aviso, y lo que no todas hacen
/// (preparar, consultar, descargar, probar) con un comportamiento por defecto inofensivo.
/// </summary>
public abstract class InboxChannelBase(InboxChannelServices services) : IInboxChannel
{
    protected InboxChannelServices Services { get; } = services;

    public abstract string Platform { get; }

    protected string Label => Platforms.Label(Platform);

    public abstract InboxAccountStatus Inspect(InboxAccountRow account, InboxEnvironment environment);

    public abstract Task<IReadOnlyList<InboxUpdate>> ParseAsync(InboxEventRow inboxEvent, IReadOnlyList<InboxAccountRow> accounts, CancellationToken cancellationToken);

    public abstract Task<PublishStep> SendAsync(InboxSendContext context, CancellationToken cancellationToken);

    public virtual Task<string?> PrepareAsync(InboxAccountRow account, InboxEnvironment environment, CancellationToken cancellationToken) =>
        Task.FromResult<string?>(null);

    /// <summary>Por defecto (plataformas que avisan por webhook): una vuelta al día para volver a preparar la cuenta.</summary>
    public virtual async Task<InboxPollResult> PollAsync(InboxAccountRow account, InboxEnvironment environment, CancellationToken cancellationToken)
    {
        string? problem = await PrepareAsync(account, environment, cancellationToken);
        return problem is null
            ? InboxPollResult.Idle(account.SyncCursor, TimeClock.UtcNow.AddDays(1))
            : InboxPollResult.Failed(account.SyncCursor, TimeClock.UtcNow.AddHours(1), problem);
    }

    public virtual Task<InboxFile?> DownloadAsync(ConnectionRow connection, string mediaId, CancellationToken cancellationToken) =>
        Task.FromResult<InboxFile?>(null);

    public virtual Task<ConnectionTest?> TestAsync(ConnectionRow connection, CancellationToken cancellationToken) =>
        Task.FromResult<ConnectionTest?>(null);

    public virtual Task<string?> InviteLinkAsync(InboxAccountRow account, string code, CancellationToken cancellationToken) =>
        Task.FromResult<string?>(null);

    protected Task<string?> TokenAsync(string connectionKey, CancellationToken cancellationToken) =>
        Services.TokenAsync(connectionKey, cancellationToken);

    /// <summary>Cuenta de esta plataforma a la que va un aviso (por su id en la plataforma).</summary>
    protected InboxAccountRow? AccountFor(IReadOnlyList<InboxAccountRow> accounts, string externalId) =>
        accounts.FirstOrDefault(a => a.Platform == Platform && a.ExternalId == externalId && a.StatusCode == ConnectionStatus.Connected);

    /// <summary>Cuenta de un aviso propio con clave «PREFIJO:{idCuenta}:…» (consultas periódicas).</summary>
    protected InboxAccountRow? AccountFromKey(IReadOnlyList<InboxAccountRow> accounts, string eventKey)
    {
        var parts = eventKey.Split(':');
        return parts.Length > 1 && int.TryParse(parts[1], out int id) ? accounts.FirstOrDefault(a => a.Id == id && a.Platform == Platform) : null;
    }

    protected PublishStep NoTokenStep(string account) => PublishStep.NoToken(account);

    protected static PublishStep WindowClosedStep(string label) =>
        PublishStep.Failed("WINDOW_CLOSED", $"Pasaron más de 24 h desde el último mensaje de la persona: {label} ya no deja responder hasta que vuelva a escribir.");

    /// <summary>Lo que falta en el servidor para que lleguen los webhooks de Meta (común a Facebook, Instagram y WhatsApp).</summary>
    protected static (string Problem, string Fix)? MetaWebhookProblem(InboxEnvironment environment)
    {
        if (!environment.PublicUrl)
            return ("Meta avisa de los mensajes a una dirección pública con https y este servidor no tiene una (App:PublicBaseUrl). " +
                    "En desarrollo usa un túnel; mira la guía.", InboxFixes.Guide);
        if (!environment.MetaAppConfigured)
            return ("Falta la app de Meta (App ID y App Secret) en Ajustes › Plataformas: sin ella no se pueden verificar los avisos.", InboxFixes.Settings);
        return null;
    }

    /// <summary>Permiso que le falta al token según los guardados al conectar (si se conocen).</summary>
    protected static string? MissingScope(InboxAccountRow account, params string[] scopes) =>
        string.IsNullOrWhiteSpace(account.Scopes) ? null : scopes.FirstOrDefault(s => !account.HasScope(s));

    #region JSON
    protected static string? Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value)
            ? value.ValueKind == JsonValueKind.String ? value.GetString() : value.ValueKind is JsonValueKind.Number ? value.GetRawText() : null
            : null;

    protected static JsonElement Child(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) ? value : default;

    protected static IEnumerable<JsonElement> Items(JsonElement element, string name) =>
        Child(element, name) is { ValueKind: JsonValueKind.Array } array ? array.EnumerateArray() : [];

    protected static DateTime UnixSeconds(JsonElement element, string name, DateTime fallback) =>
        long.TryParse(Text(element, name), out long seconds) ? DateTimeOffset.FromUnixTimeSeconds(seconds).UtcDateTime : fallback;
    #endregion
}

public sealed class InboxChannelServices(ConnectionRepository connections, SecretProtector protector)
{
    public ConnectionRepository Connections { get; } = connections;
    public SecretProtector Protector { get; } = protector;

    public async Task<string?> TokenAsync(string connectionKey, CancellationToken cancellationToken) =>
        Protector.UnprotectOrNull(await Connections.TokenGet(connectionKey, cancellationToken));
}
