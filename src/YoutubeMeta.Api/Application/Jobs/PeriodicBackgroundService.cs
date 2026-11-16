namespace YoutubeMeta.Api.Application.Jobs;

/// <summary>Un bucle independiente dentro de un job: su propio ritmo, su propio scope de DI por ciclo.</summary>
public sealed record JobLane(string Name, TimeSpan Delay, bool RunOnStartup, Func<IServiceProvider, CancellationToken, Task> Cycle);

/// <summary>
/// Base de los jobs: cada <see cref="JobLane"/> corre en su propio bucle (una vuelta termina antes de esperar la
/// siguiente, así que nunca se solapa consigo misma), con scope de DI nuevo por ciclo, arranque inmediato opcional
/// y errores registrados sin tumbar el host. Los carriles de un mismo job no se esperan entre sí.
/// </summary>
public abstract class PeriodicBackgroundService(IServiceProvider rootServices, ILogger logger) : BackgroundService
{
    protected ILogger Logger { get; } = logger;

    protected virtual string JobName => GetType().Name;

    protected abstract IEnumerable<JobLane> Lanes { get; }

    /// <summary>Un paso que falla se registra y cuenta como 0: los demás pasos del ciclo siguen.</summary>
    protected async Task<int> StepAsync(string step, Func<Task<int>> action, CancellationToken cancellationToken)
    {
        try
        {
            return await action();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "{Job}: el paso '{Step}' falló; se sigue con los demás.", JobName, step);
            return 0;
        }
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Task.WhenAll(Lanes.Select(lane => Task.Run(() => RunLaneAsync(lane, stoppingToken), stoppingToken)));

    private async Task RunLaneAsync(JobLane lane, CancellationToken stoppingToken)
    {
        Logger.LogInformation("{Job}/{Lane} iniciado. Delay={Delay}, RunOnStartup={RunOnStartup}.", JobName, lane.Name, lane.Delay, lane.RunOnStartup);

        try
        {
            if (lane.RunOnStartup) await RunCycleAsync(lane, stoppingToken);

            while (!stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(lane.Delay, stoppingToken);
                await RunCycleAsync(lane, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }

        Logger.LogInformation("{Job}/{Lane} detenido.", JobName, lane.Name);
    }

    private async Task RunCycleAsync(JobLane lane, CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = rootServices.CreateAsyncScope();
            await lane.Cycle(scope.ServiceProvider, cancellationToken);
            JobHeartbeats.Beat($"{JobName}/{lane.Name}");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "{Job}/{Lane}: error no controlado en el ciclo.", JobName, lane.Name);
        }
    }
}

/// <summary>Última vuelta completada de cada carril (lo muestra /health para detectar un job parado).</summary>
public static class JobHeartbeats
{
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, DateTime> Last = new();

    public static void Beat(string lane) => Last[lane] = TimeClock.UtcNow;

    public static IReadOnlyDictionary<string, DateTime> Snapshot() => new Dictionary<string, DateTime>(Last);
}
