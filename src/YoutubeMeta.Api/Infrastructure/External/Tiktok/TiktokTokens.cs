using System.Collections.Concurrent;
using System.Text.Json;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Infrastructure.External.Tiktok;

public sealed record TiktokAccess(string? Token, bool IsTransientFailure)
{
    public static TiktokAccess Ok(string token) => new(token, false);
    /// <summary>No hay token o TikTok lo rechazó: la cuenta queda pendiente de reconexión.</summary>
    public static readonly TiktokAccess Rejected = new(null, false);
    /// <summary>TikTok no respondió bien (5xx, 429, red): se reintenta más tarde sin tocar la cuenta.</summary>
    public static readonly TiktokAccess Transient = new(null, true);
}

/// <summary>
/// Access token vigente de una cuenta de TikTok. Dura 2 h: se renueva 5 min antes y se guarda el par nuevo, porque
/// cada renovación invalida el refresh token anterior. Un candado por cuenta evita dos renovaciones a la vez en el
/// mismo proceso (la segunda usaría un refresh token ya gastado y desconectaría la cuenta); por eso en IIS hay que
/// desactivar el reciclado solapado (ver README).
/// </summary>
public sealed class TiktokTokens(TiktokClient tiktok, PlatformKeys keys, ConnectionRepository connections, SecretProtector protector, ILogger<TiktokTokens> logger)
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Locks = new();
    private static readonly TimeSpan RefreshMargin = TimeSpan.FromMinutes(5);

    public async Task<TiktokAccess> AccessTokenAsync(string connectionKey, CancellationToken cancellationToken)
    {
        var gate = Locks.GetOrAdd(connectionKey, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            var token = Read(await connections.TokenGet(connectionKey, cancellationToken));
            if (token is null) return TiktokAccess.Rejected;

            if (DateTimeOffset.FromUnixTimeSeconds(token.ExpiresAt) - DateTimeOffset.UtcNow > RefreshMargin)
                return TiktokAccess.Ok(token.AccessToken);

            var settings = (await keys.TiktokAsync(cancellationToken)).Settings;
            var refreshed = await tiktok.RefreshAsync(settings, token.RefreshToken, cancellationToken);
            if (!refreshed.Ok)
            {
                logger.LogWarning("TikTok no renovó el token: {Code} (HTTP {Status}).", refreshed.Error!.Code, refreshed.Error.HttpStatus);
                if (!IsRejection(refreshed.Error)) return TiktokAccess.Transient;

                await connections.MarkNeedsReconnect(connectionKey, "TikTok rechazó el acceso (revocado o caducado). Vuelve a conectar la cuenta.", CancellationToken.None);
                return TiktokAccess.Rejected;
            }

            await connections.TokenSave(connectionKey, Protect(refreshed.Data!), CancellationToken.None);
            return TiktokAccess.Ok(refreshed.Data!.AccessToken);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "TikTok no respondió al renovar el token.");
            return TiktokAccess.Transient;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>Solo un 4xx que no sea «demasiadas peticiones» significa que el refresh token ya no sirve.</summary>
    public static bool IsRejection(TiktokError error) => error.HttpStatus is >= 400 and < 500 and not 429 && error.Code != "rate_limit_exceeded";

    public string Protect(TiktokToken token) => protector.Protect(JsonSerializer.Serialize(token));

    public TiktokToken? Read(string? cipher)
    {
        string? json = protector.UnprotectOrNull(cipher);
        return json is null ? null : JsonSerializer.Deserialize<TiktokToken>(json);
    }
}
