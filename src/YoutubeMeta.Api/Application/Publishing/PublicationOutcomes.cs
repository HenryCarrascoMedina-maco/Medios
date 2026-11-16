using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Application.Publishing;

/// <summary>Datos de la fila que deciden cómo se cierra un intento.</summary>
public readonly record struct AttemptContext(string Target, int Attempts, int MaxAttempts, int PollCount, bool IsPoll);

/// <summary>
/// Máquina de estados de la cola: traduce el <see cref="PublishStep"/> de una plataforma a la fila que se guarda.
/// Función pura (sin BD ni reloj propio) para poder probar cada transición.
/// <list type="bullet">
/// <item>Todo lo que se repite solo tiene tope (<c>MaxAttempts</c>): nunca hay bucles infinitos.</item>
/// <item>Mientras se consulta algo ya subido, un error pasajero no vuelve a subirlo: se reprograma la consulta.</item>
/// <item>Si la plataforma descartó lo subido (Restart), se vuelve a subir solo: el usuario no tiene que hacer nada.</item>
/// </list>
/// </summary>
public static class PublicationOutcomes
{
    public static readonly TimeSpan[] PollDelays = [TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(5)];
    public static readonly TimeSpan PollDelayMax = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan RestartDelay = TimeSpan.FromMinutes(1);

    public static TimeSpan PollDelay(int pollCount) => pollCount < PollDelays.Length ? PollDelays[pollCount] : PollDelayMax;

    /// <summary>null = no escribir nada (lease perdido).</summary>
    public static PublicationResult? ToResult(PublishStep step, AttemptContext ctx, int backoffMinutes, DateTime now)
    {
        string platform = Platforms.Label(ctx.Target);
        bool exhausted = ctx.MaxAttempts > 0 && ctx.Attempts >= ctx.MaxAttempts;

        return step.Outcome switch
        {
            PublishOutcome.LeaseLost => null,

            PublishOutcome.Processing => new(PublicationStatus.Processing, step.ExternalId, step.ExternalUrl, Warning: step.Warning,
                NextAttemptAt: now + PollDelays[0], ClearSession: true, EventMessage: $"Subido a {platform}; procesando."),

            PublishOutcome.Done => new(PublicationStatus.Done, ExternalId: step.ExternalId, ExternalUrl: step.ExternalUrl, Warning: step.Warning, IsPoll: ctx.IsPoll, ClearSession: true,
                EventMessage: step.Warning is null ? $"Publicado en {platform}." : $"Publicado en {platform}. {step.Warning}", IsNotification: true,
                CommentExternalId: step.CommentId),

            // La plataforma descartó lo que ya tenía: se sube de nuevo desde cero, con tope.
            PublishOutcome.Restart when exhausted => new(PublicationStatus.Failed, ErrorCode: step.ErrorCode,
                ErrorMessage: $"{platform} descartó la subida {ctx.Attempts} veces seguidas. Suele ser una conexión lenta o inestable con {platform}: " +
                              "revisa la red del servidor y pulsa «Reintentar».",
                ClearSession: true, ClearExternal: true, IsPoll: ctx.IsPoll,
                EventMessage: $"Falló tras {ctx.Attempts} intentos desde cero: {step.Message}", IsNotification: true),

            PublishOutcome.Restart => new(PublicationStatus.Pending, ErrorCode: step.ErrorCode, ErrorMessage: step.Message,
                NextAttemptAt: now + RestartDelay, ClearSession: true, ClearExternal: ctx.IsPoll, IsPoll: ctx.IsPoll, EventMessage: step.Message),

            // Mientras se consulta el estado (ya subido) nada hace volver a subir: se reprograma la consulta.
            PublishOutcome.StillProcessing or PublishOutcome.Retry when ctx.IsPoll =>
                new(PublicationStatus.Processing, NextAttemptAt: now + PollDelay(ctx.PollCount + 1), IsPoll: true),

            PublishOutcome.WaitQuota when ctx.IsPoll =>
                new(PublicationStatus.Processing, ErrorCode: step.ErrorCode, ErrorMessage: step.Message, NextAttemptAt: step.NextAttemptAt, IsPoll: true),

            PublishOutcome.Retry when exhausted => new(PublicationStatus.Failed, ErrorCode: step.ErrorCode,
                ErrorMessage: $"{step.Message} Se intentó {ctx.Attempts} veces sin éxito; pulsa «Reintentar» cuando se haya resuelto.",
                ClearSession: true, EventMessage: $"Falló tras {ctx.Attempts} intentos: {step.Message}", IsNotification: true),

            PublishOutcome.Retry => new(PublicationStatus.Pending, ErrorCode: step.ErrorCode, ErrorMessage: step.Message,
                NextAttemptAt: now.AddMinutes(backoffMinutes * Math.Max(ctx.Attempts, 1)), EventMessage: $"Reintento programado: {step.Message}"),

            PublishOutcome.WaitQuota => new(PublicationStatus.WaitingQuota, ErrorCode: step.ErrorCode, ErrorMessage: step.Message,
                NextAttemptAt: step.NextAttemptAt, EventMessage: step.Message, IsNotification: true),

            PublishOutcome.NeedsReconnect => new(PublicationStatus.NeedsReconnect, ErrorCode: step.ErrorCode, ErrorMessage: step.Message,
                IsPoll: ctx.IsPoll, EventMessage: step.Message, IsNotification: true),

            // Se conserva la sesión: puede servir para comprobarlo más tarde o reanudar.
            PublishOutcome.NeedsReview => new(PublicationStatus.NeedsReview, ExternalId: step.ExternalId, ExternalUrl: step.ExternalUrl,
                ErrorCode: step.ErrorCode, ErrorMessage: step.Message, IsPoll: ctx.IsPoll, EventMessage: step.Message, IsNotification: true),

            _ => new(PublicationStatus.Failed, ErrorCode: step.ErrorCode, ErrorMessage: step.Message,
                ClearSession: true, IsPoll: ctx.IsPoll, EventMessage: step.Message, IsNotification: true)
        };
    }
}
