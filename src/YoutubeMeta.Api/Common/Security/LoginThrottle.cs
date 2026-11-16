using Microsoft.Extensions.Caching.Memory;

namespace YoutubeMeta.Api.Common.Security;

/// <summary>
/// Bloqueo progresivo de inicios de sesión fallidos por IP: los primeros <see cref="FreeAttempts"/> errores no
/// cuestan nada; a partir de ahí cada error duplica la espera (1, 2, 4… min, hasta <see cref="MaxLockout"/>). Un
/// acierto lo reinicia. Va por IP para que nadie pueda dejar fuera al administrador desde otra máquina.
/// </summary>
public sealed class LoginThrottle(IMemoryCache cache, TimeProvider time)
{
    public const int FreeAttempts = 5;
    public static readonly TimeSpan MaxLockout = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan Memory = TimeSpan.FromHours(6);

    private sealed class Entry
    {
        public int Failures;
        public DateTimeOffset LockedUntil;
    }

    /// <summary>Tiempo que falta para poder intentarlo, o null si puede intentarlo ya.</summary>
    public TimeSpan? RetryAfter(string ip)
    {
        if (!cache.TryGetValue(Key(ip), out Entry? entry) || entry is null) return null;
        var left = entry.LockedUntil - time.GetUtcNow();
        return left > TimeSpan.Zero ? left : null;
    }

    public void Failure(string ip)
    {
        var entry = cache.GetOrCreate(Key(ip), e =>
        {
            e.SlidingExpiration = Memory;
            return new Entry();
        })!;

        lock (entry)
        {
            entry.Failures++;
            if (entry.Failures < FreeAttempts) return;
            var wait = TimeSpan.FromMinutes(Math.Pow(2, entry.Failures - FreeAttempts));
            entry.LockedUntil = time.GetUtcNow() + (wait < MaxLockout ? wait : MaxLockout);
        }
    }

    public void Success(string ip) => cache.Remove(Key(ip));

    private static string Key(string ip) => $"login-throttle:{ip}";
}
