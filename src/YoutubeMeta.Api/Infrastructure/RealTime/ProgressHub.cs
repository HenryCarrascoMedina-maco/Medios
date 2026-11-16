using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace YoutubeMeta.Api.Infrastructure.RealTime;

/// <summary>Equivalente al EntityHub de Sinsatools.RealTime, dentro del mismo proceso.</summary>
[Authorize]
public sealed class ProgressHub : Hub;

public interface IProgressNotifier
{
    Task NotifyAsync(string entity, object data, CancellationToken cancellationToken = default);
}

public static class ProgressNotifierExtensions
{
    /// <summary>Conexiones vuelve a cargar las cuentas de la plataforma.</summary>
    public static Task ConnectionChangedAsync(this IProgressNotifier notifier, string platform, CancellationToken cancellationToken = default) =>
        notifier.NotifyAsync(RealTimeEntities.Connection, new { platform, isFinal = true }, cancellationToken);
}

public sealed class ProgressNotifier(IHubContext<ProgressHub> hub, ILogger<ProgressNotifier> logger) : IProgressNotifier
{
    /// <summary>Broadcast a todos; el front filtra por entidad. Un fallo de aviso nunca rompe el proceso que avisa.</summary>
    public async Task NotifyAsync(string entity, object data, CancellationToken cancellationToken = default)
    {
        try
        {
            await hub.Clients.All.SendAsync("ReceiveEntityUpdate", entity, data, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "No se pudo emitir {Entity} por SignalR.", entity);
        }
    }
}
