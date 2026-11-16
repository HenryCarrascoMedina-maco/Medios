using YoutubeMeta.Api.Infrastructure.RealTime;

namespace YoutubeMeta.Api.Application.Publishing;

/// <summary>Lo que el latido necesita de la cola (lo implementa PublicationRepository; en pruebas, un doble).</summary>
public interface IPublicationLease
{
    /// <summary>Renueva el lease y guarda el avance. 0 = otro proceso tomó la fila.</summary>
    Task<int> LeaseExtend(long id, string leaseOwner, int leaseMinutes, long bytesSent, long totalBytes, int percent, CancellationToken cancellationToken);

    /// <summary>Marca que empieza el paso irreversible (la plataforma puede publicar a partir de aquí).</summary>
    Task<int> CommitMark(long id, string leaseOwner, CancellationToken cancellationToken);
}

/// <summary>
/// Acompaña una subida larga: cada ProgressEverySeconds renueva el lease, guarda el avance y avisa por SignalR
/// (como mucho un aviso por latido). Si la renovación afecta 0 filas, otro proceso tomó la publicación: se cancela
/// <see cref="Token"/> para cortar la subida en curso.
/// <para>
/// Un fallo de la BD en un latido NUNCA tumba la subida ni tapa su resultado: se registra y se reintenta en el
/// siguiente. Solo si la BD sigue caída tanto tiempo que el lease pudo vencer se da por perdido, para no subir
/// dos veces lo mismo.
/// </para>
/// </summary>
public sealed class UploadHeartbeat : IAsyncDisposable
{
    /// <summary>Margen antes de que venza el lease en el que, sin poder renovarlo, se corta la subida.</summary>
    private static readonly TimeSpan LeaseSafetyMargin = TimeSpan.FromMinutes(1);

    private readonly IPublicationLease _lease;
    private readonly IProgressNotifier _notifier;
    private readonly ILogger _logger;
    private readonly PublicationDueItem _item;
    private readonly string _leaseOwner;
    private readonly VideoPublishSettings _settings;
    private readonly TimeProvider _time;
    private readonly CancellationTokenSource _cts;
    private readonly Task _loop;

    private long _sent;
    private long _total;
    private int _lastPercent = -1;
    private DateTimeOffset _lastRenewal;

    public UploadHeartbeat(
        IPublicationLease lease,
        IProgressNotifier notifier,
        ILogger logger,
        PublicationDueItem item,
        string leaseOwner,
        VideoPublishSettings settings,
        CancellationToken stoppingToken,
        TimeProvider? time = null)
    {
        _lease = lease;
        _notifier = notifier;
        _logger = logger;
        _item = item;
        _leaseOwner = leaseOwner;
        _settings = settings;
        _time = time ?? TimeProvider.System;
        _total = item.SizeBytes;
        _lastRenewal = _time.GetUtcNow();
        _cts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        _loop = RunAsync();
    }

    public CancellationToken Token => _cts.Token;

    public bool LeaseLost { get; private set; }

    /// <summary>true desde que la plataforma pudo empezar a publicar: un error a partir de aquí es un resultado dudoso.</summary>
    public bool Committing { get; private set; }

    public long BytesSent => Interlocked.Read(ref _sent);

    public void Report(long sent, long total)
    {
        Interlocked.Exchange(ref _sent, sent);
        if (total > 0) Interlocked.Exchange(ref _total, total);
    }

    /// <summary>
    /// Llamar justo antes del paso irreversible. Se guarda en BD para que, si el proceso muere, la siguiente vuelta
    /// compruebe primero si ya se publicó en vez de volver a subirlo.
    /// </summary>
    public async Task MarkCommittingAsync()
    {
        if (Committing) return;
        Committing = true;
        try
        {
            await _lease.CommitMark(_item.Id, _leaseOwner, CancellationToken.None);
        }
        catch (Exception ex)
        {
            // El indicador en memoria basta mientras el proceso siga vivo.
            _logger.LogWarning(ex, "Publicación {Id}: no se pudo guardar la marca del paso irreversible.", _item.Id);
        }
    }

    private async Task RunAsync()
    {
        var period = TimeSpan.FromSeconds(Math.Max(_settings.ProgressEverySeconds, 5));
        using var timer = new PeriodicTimer(period, _time);
        try
        {
            while (await timer.WaitForNextTickAsync(_cts.Token))
                await BeatSafelyAsync();
        }
        catch (OperationCanceledException)
        {
            // Fin de la subida o apagado.
        }
    }

    private async Task BeatSafelyAsync()
    {
        try
        {
            await BeatAsync();
        }
        catch (OperationCanceledException) when (_cts.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            TimeSpan withoutRenewal = _time.GetUtcNow() - _lastRenewal;
            _logger.LogWarning(ex, "Publicación {Id}: falló el latido ({Elapsed:n0} s sin renovar el lease).", _item.Id, withoutRenewal.TotalSeconds);

            if (withoutRenewal >= TimeSpan.FromMinutes(_settings.LeaseMinutes) - LeaseSafetyMargin)
            {
                _logger.LogError("Publicación {Id}: no se pudo renovar el lease a tiempo; se corta la subida para no publicar dos veces.", _item.Id);
                LeaseLost = true;
                await _cts.CancelAsync();
            }
        }
    }

    private async Task BeatAsync()
    {
        long sent = Interlocked.Read(ref _sent);
        long total = Math.Max(Interlocked.Read(ref _total), 1);
        int percent = (int)Math.Clamp(sent * 100 / total, 0, 100);

        int affected = await _lease.LeaseExtend(_item.Id, _leaseOwner, _settings.LeaseMinutes, sent, total, percent, _cts.Token);
        if (affected == 0)
        {
            LeaseLost = true;
            await _cts.CancelAsync();
            return;
        }
        _lastRenewal = _time.GetUtcNow();

        if (percent == _lastPercent) return;
        _lastPercent = percent;
        await _notifier.NotifyAsync(RealTimeEntities.VideoPublish, new
        {
            publicationId = _item.Id,
            videoId = _item.VideoId,
            connectionId = _item.ConnectionId,
            target = _item.Target,
            status = PublicationStatus.Uploading,
            percent,
            isFinal = false
        }, _cts.Token);
    }

    /// <summary>Nunca lanza: el resultado de la subida es lo que importa.</summary>
    public async ValueTask DisposeAsync()
    {
        try
        {
            if (!_cts.IsCancellationRequested) await _cts.CancelAsync();
            await _loop;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Publicación {Id}: error al cerrar el latido.", _item.Id);
        }
        finally
        {
            _cts.Dispose();
        }
    }
}
