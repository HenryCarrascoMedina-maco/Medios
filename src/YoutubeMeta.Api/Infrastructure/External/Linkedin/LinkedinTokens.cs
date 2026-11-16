using System.Collections.Concurrent;
using System.Text.Json;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Infrastructure.External.Linkedin;

/// <summary>Access token vigente de una cuenta de LinkedIn, o por qué no lo hay.</summary>
public sealed record LinkedinAccess(string? Token, LinkedinToken? Data, string? Problem)
{
    public static LinkedinAccess Ok(LinkedinToken token) => new(token.AccessToken, token, null);
    public static LinkedinAccess Fail(string problem) => new(null, null, problem);
}

/// <summary>
/// Tokens de LinkedIn. Los de las apps de autoservicio duran 60 días y no se renuevan: al caducar, la cuenta pasa a
/// «Reconectar» con el motivo. Si LinkedIn entregó refresh token (apps aprobadas), se renueva solo 1 día antes.
/// </summary>
public sealed class LinkedinTokens(LinkedinClient linkedin, PlatformKeys keys, ConnectionRepository connections, SecretProtector protector, ILogger<LinkedinTokens> logger)
{
    public const string ExpiredMessage = "El acceso a LinkedIn caducó (LinkedIn lo da por 60 días). Vuelve a conectar la cuenta en Conexiones; lo pendiente seguirá solo.";
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Locks = new();
    private static readonly TimeSpan RefreshMargin = TimeSpan.FromDays(1);

    public async Task<LinkedinAccess> AccessAsync(string connectionKey, CancellationToken cancellationToken)
    {
        var gate = Locks.GetOrAdd(connectionKey, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            var token = Read(await connections.TokenGet(connectionKey, cancellationToken));
            if (token is null) return LinkedinAccess.Fail("La cuenta de LinkedIn no tiene un acceso válido. Vuelve a conectarla en Conexiones.");

            var left = token.ExpiresAtUtc - DateTime.UtcNow;
            if (left > RefreshMargin) return LinkedinAccess.Ok(token);

            bool canRefresh = token.RefreshToken is { Length: > 0 }
                && (token.RefreshExpiresAt is null || DateTimeOffset.FromUnixTimeSeconds(token.RefreshExpiresAt.Value) > DateTimeOffset.UtcNow);
            if (canRefresh)
            {
                var app = (await keys.LinkedinAsync(token.IsOrganization, cancellationToken)).Settings;
                var refreshed = await linkedin.RefreshAsync(app, token.RefreshToken!, cancellationToken);
                if (refreshed.Ok)
                {
                    await connections.TokenSave(connectionKey, Protect(refreshed.Data!), CancellationToken.None);
                    return LinkedinAccess.Ok(refreshed.Data!);
                }
                logger.LogWarning("LinkedIn no renovó el token: {Code} (HTTP {Status}).", refreshed.Error!.Code, refreshed.Error.HttpStatus);
            }

            // Sin renovación: mientras no haya caducado se sigue usando; después hay que reconectar.
            if (left > TimeSpan.Zero) return LinkedinAccess.Ok(token);
            await connections.MarkNeedsReconnect(connectionKey, ExpiredMessage, CancellationToken.None);
            return LinkedinAccess.Fail(ExpiredMessage);
        }
        finally
        {
            gate.Release();
        }
    }

    public string Protect(LinkedinToken token) => protector.Protect(JsonSerializer.Serialize(token));

    public LinkedinToken? Read(string? cipher)
    {
        string? json = protector.UnprotectOrNull(cipher);
        if (json is null) return null;
        try
        {
            return JsonSerializer.Deserialize<LinkedinToken>(json);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
