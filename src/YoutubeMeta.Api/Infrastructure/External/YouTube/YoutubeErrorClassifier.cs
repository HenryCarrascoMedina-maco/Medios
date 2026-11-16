using Google;
using Google.Apis.Auth.OAuth2.Responses;
using System.Net;
using YoutubeMeta.Api.Application.Publishing;

namespace YoutubeMeta.Api.Infrastructure.External.YouTube;

/// <summary>Cada error de YouTube termina en una sola acción del job.</summary>
public static class YoutubeErrorClassifier
{
    private static readonly HashSet<string> ReconnectReasons = new(StringComparer.OrdinalIgnoreCase)
    {
        "authorizationRequired", "insufficientPermissions", "youtubeSignupRequired", "unauthorized"
    };

    private static readonly HashSet<string> AccountClosedReasons = new(StringComparer.OrdinalIgnoreCase)
    {
        "authenticatedUserAccountClosed", "authenticatedUserAccountSuspended"
    };

    public static PublishStep Classify(Exception? exception)
    {
        switch (exception)
        {
            case null:
                return PublishStep.Retry("UNKNOWN", "La subida terminó sin respuesta de YouTube.");

            case TokenResponseException token:
                return PublishStep.NeedsReconnect(token.Error?.Error ?? "invalid_grant",
                    "Google rechazó el acceso del canal. Vuelve a conectarlo en Conexiones.");

            case GoogleApiException api:
                return ClassifyApi(api);

            case HttpRequestException or IOException or TaskCanceledException:
                return PublishStep.Network("YouTube");

            default:
                return PublishStep.Retry("UNEXPECTED", $"Error inesperado con YouTube ({exception.GetType().Name}). Se reintenta solo.");
        }
    }

    private static PublishStep ClassifyApi(GoogleApiException api)
    {
        string reason = api.Error?.Errors?.FirstOrDefault()?.Reason ?? string.Empty;
        string message = api.Error?.Message ?? api.Message;
        int status = (int)api.HttpStatusCode;

        if (reason.Equals("quotaExceeded", StringComparison.OrdinalIgnoreCase))
            return PublishStep.WaitQuota(reason, "Cuota diaria de YouTube agotada. Se reintenta solo a las 00:05 hora del Pacífico.", TimeClock.NextPacificMidnightUtc());

        if (reason.Equals("uploadLimitExceeded", StringComparison.OrdinalIgnoreCase))
            return PublishStep.WaitQuota(reason, "El canal alcanzó su límite diario de subidas. Se reintenta en 24 h.", TimeClock.UtcNow.AddHours(24));

        if (status == (int)HttpStatusCode.Unauthorized || ReconnectReasons.Contains(reason))
            return PublishStep.NeedsReconnect(reason.Length > 0 ? reason : "401", "El canal conectado no tiene permiso para subir. Vuelve a conectarlo.");

        if (AccountClosedReasons.Contains(reason))
            return PublishStep.Failed(reason, "La cuenta de YouTube está cerrada o suspendida.");

        if (status == (int)HttpStatusCode.NotFound)
            return PublishStep.Restart("SESSION_EXPIRED", "La sesión de subida caducó; se sube de nuevo desde el inicio.");

        if (status >= 500 || status == 429)
            return PublishStep.Retry($"HTTP_{status}", $"YouTube respondió {status}: {message}");

        return PublishStep.Failed(reason.Length > 0 ? reason : $"HTTP_{status}", $"YouTube rechazó la publicación: {message}");
    }
}
