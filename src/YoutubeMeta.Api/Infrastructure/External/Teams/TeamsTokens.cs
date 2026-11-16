using System.Collections.Concurrent;
using System.Text.Json;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Infrastructure.External.Teams;

/// <summary>Access token vigente de un canal de Teams (Graph), o por qué no lo hay.</summary>
public sealed record TeamsAccess(string? Token, string? Problem, bool IsTransient)
{
    public static TeamsAccess Ok(string token) => new(token, null, false);
    public static TeamsAccess Rejected(string problem) => new(null, problem, false);
    public static TeamsAccess Transient(string problem) => new(null, problem, true);
}

/// <summary>
/// El access token de Microsoft dura ~1 h: se renueva 5 min antes con el refresh token (que se renueva solo mientras
/// se use; el job de prueba de cuentas lo mantiene vivo). Si Microsoft lo rechaza (contraseña cambiada, acceso
/// revocado por la organización), el canal pasa a «Reconectar» con el motivo.
/// </summary>
public sealed class TeamsTokens(TeamsClient teams, PlatformKeys keys, ConnectionRepository connections, SecretProtector protector, ILogger<TeamsTokens> logger)
{
    public const string RejectedMessage = "Microsoft pidió volver a iniciar sesión (cambio de contraseña o la organización revocó el acceso). Reconecta Teams en Conexiones; lo pendiente seguirá solo.";
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Locks = new();
    private static readonly TimeSpan RefreshMargin = TimeSpan.FromMinutes(5);

    public async Task<TeamsAccess> AccessAsync(string connectionKey, CancellationToken cancellationToken)
    {
        var gate = Locks.GetOrAdd(connectionKey, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            var token = Read(await connections.TokenGet(connectionKey, cancellationToken));
            if (token is null) return TeamsAccess.Rejected("El canal de Teams no tiene un acceso válido. Vuelve a conectar Teams en Conexiones.");
            if (DateTimeOffset.FromUnixTimeSeconds(token.ExpiresAt) - DateTimeOffset.UtcNow > RefreshMargin) return TeamsAccess.Ok(token.AccessToken);

            var app = (await keys.TeamsAsync(cancellationToken)).Settings;
            var refreshed = await teams.RefreshAsync(app, token.RefreshToken, cancellationToken, TeamsClient.ScopesFor(token.Scope));
            if (!refreshed.Ok)
            {
                logger.LogWarning("Microsoft no renovó el token de Teams: {Code} (HTTP {Status}).", refreshed.Error!.Code, refreshed.Error.HttpStatus);
                if (refreshed.Error.IsTransient) return TeamsAccess.Transient("Microsoft no responde ahora mismo. Se reintenta solo.");
                await connections.MarkNeedsReconnect(connectionKey, RejectedMessage, CancellationToken.None);
                return TeamsAccess.Rejected(RejectedMessage);
            }

            // Algunas respuestas no traen refresh token nuevo: se conserva el anterior.
            if (refreshed.Data!.RefreshToken.Length == 0) refreshed.Data.RefreshToken = token.RefreshToken;
            await connections.TokenSave(connectionKey, Protect(refreshed.Data), CancellationToken.None);
            return TeamsAccess.Ok(refreshed.Data.AccessToken);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "Microsoft no respondió al renovar el token de Teams.");
            return TeamsAccess.Transient("Microsoft no responde ahora mismo. Se reintenta solo.");
        }
        finally
        {
            gate.Release();
        }
    }

    public string Protect(TeamsToken token) => protector.Protect(JsonSerializer.Serialize(token));

    public TeamsToken? Read(string? cipher)
    {
        string? json = protector.UnprotectOrNull(cipher);
        if (json is null) return null;
        try
        {
            return JsonSerializer.Deserialize<TeamsToken>(json);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
