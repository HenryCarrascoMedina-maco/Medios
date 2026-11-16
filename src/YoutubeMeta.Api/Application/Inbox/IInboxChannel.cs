using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Domain.Rules;

namespace YoutubeMeta.Api.Application.Inbox;

/// <summary>
/// Lo que la bandeja necesita de cada plataforma. Añadir una plataforma = implementar esto (normalmente heredando de
/// <see cref="InboxChannelBase"/>) y registrarlo en DependencyInjection; la cola, los reintentos y los avisos no cambian.
/// </summary>
public interface IInboxChannel
{
    string Platform { get; }

    /// <summary>Qué puede recibir la cuenta, cómo le llegan los mensajes y qué le falta (con la forma de arreglarlo).</summary>
    InboxAccountStatus Inspect(InboxAccountRow account, InboxEnvironment environment);

    /// <summary>Prepara la cuenta para recibir: suscribe la app a los webhooks o pone el del bot. Devuelve el problema o null.</summary>
    Task<string?> PrepareAsync(InboxAccountRow account, InboxEnvironment environment, CancellationToken cancellationToken);

    /// <summary>
    /// Vuelta periódica de la cuenta: trae lo nuevo en crudo (lo que la plataforma no avisa) y mantiene los webhooks.
    /// Devuelve el cursor y cuándo volver.
    /// </summary>
    Task<InboxPollResult> PollAsync(InboxAccountRow account, InboxEnvironment environment, CancellationToken cancellationToken);

    /// <summary>Un aviso en crudo (webhook o consulta) → mensajes y acuses normalizados.</summary>
    Task<IReadOnlyList<InboxUpdate>> ParseAsync(InboxEventRow inboxEvent, IReadOnlyList<InboxAccountRow> accounts, CancellationToken cancellationToken);

    /// <summary>Envía una respuesta: Done con el id del mensaje en la plataforma; el resto, como en el job de publicación.</summary>
    Task<PublishStep> SendAsync(InboxSendContext context, CancellationToken cancellationToken);

    /// <summary>Un archivo recibido (WhatsApp, Telegram) para verlo desde la app; null si no se puede.</summary>
    Task<InboxFile?> DownloadAsync(ConnectionRow connection, string mediaId, CancellationToken cancellationToken);

    /// <summary>Prueba de una cuenta que no publica (WhatsApp). Null = la prueba la hace su publicador.</summary>
    Task<ConnectionTest?> TestAsync(ConnectionRow connection, CancellationToken cancellationToken);

    /// <summary>
    /// Enlace para que una persona abra el chat con la cuenta llevando <paramref name="code"/> (Telegram ?start=,
    /// Messenger ?ref=). Al llegar, el adaptador lo devuelve como <see cref="InboxReferral"/>. Null = la red no lo permite.
    /// </summary>
    Task<string?> InviteLinkAsync(InboxAccountRow account, string code, CancellationToken cancellationToken);
}

/// <summary>Lo que depende del servidor y no de la cuenta.</summary>
/// <param name="PublicBaseUrl">https://… si la API es accesible desde internet (sin él no llegan webhooks).</param>
/// <param name="MetaAppConfigured">Hay App Secret de Meta para verificar los webhooks de Facebook, Instagram y WhatsApp.</param>
public sealed record InboxEnvironment(string? PublicBaseUrl, bool MetaAppConfigured, InboxSettings Settings)
{
    public bool PublicUrl => PublicBaseUrl is not null;
}

public static class InboxFixes
{
    public const string Reconnect = "RECONNECT";
    public const string Settings = "SETTINGS";
    public const string Guide = "GUIDE";
}

/// <param name="Mode">WEBHOOK, POLL o NONE (<see cref="InboxModes"/>).</param>
/// <param name="Problem">Qué falta para recibir, en palabras del usuario.</param>
/// <param name="Fix">Cómo se arregla: RECONNECT, SETTINGS o GUIDE (<see cref="InboxFixes"/>).</param>
public sealed record InboxAccountStatus(bool SupportsDirect, bool SupportsComments, string Mode, string? Problem = null, string? Fix = null)
{
    public bool CanReceive => Mode != InboxModes.None && Problem is null;
}

public sealed record InboxPollResult(IReadOnlyList<InboxRawEvent> Events, string? Cursor, DateTime NextRunAt, string? Error = null)
{
    public static InboxPollResult Idle(string? cursor, DateTime nextRunAt) => new([], cursor, nextRunAt);
    public static InboxPollResult Failed(string? cursor, DateTime nextRunAt, string error) => new([], cursor, nextRunAt, error);
}

/// <summary>Medio de la biblioteca adjunto a una respuesta, con su ruta local y, si hay dirección pública, su enlace firmado.</summary>
public sealed record InboxMediaFile(int Id, string Path, string FileName, string ContentType, string MediaKind, string? PublicUrl);

/// <param name="Window">Si la ventana de 24 h está abierta, solo se puede con la etiqueta «agente humano» o está cerrada.</param>
public sealed record InboxSendContext(InboxSendItem Item, IReadOnlyList<InboxMediaFile> Media, InboxWindowState Window);

public sealed record InboxFile(Stream Content, string ContentType, string? FileName);
