using YoutubeMeta.Api.Common.Security;

namespace YoutubeMeta.Api.Application.Services;

/// <summary>Lo común al OAuth de las cuentas (YouTube, TikTok, LinkedIn y Teams).</summary>
internal static class OAuthAccounts
{
    public const string DefaultReturnUrl = "/connections";
    public const string InvalidReturnUrl = "La dirección de regreso debe ser una ruta de la aplicación.";

    /// <summary>state firmado con la ruta de regreso; null si esa ruta no es de la propia app.</summary>
    public static string? CreateState(string purpose, int userId, string? returnUrl, string secret) =>
        OAuthState.SafeReturnUrl(returnUrl ?? DefaultReturnUrl) is { } safeUrl
            ? OAuthState.Create(purpose, userId, safeUrl, DateTimeOffset.UtcNow.ToUnixTimeSeconds() + OAuthState.LifetimeSeconds, secret)
            : null;

    /// <summary>Pase lo que pase, la vuelta redirige al front con el resultado: nunca deja un 500 en el navegador.</summary>
    public static async Task<string> SafeCallbackAsync(Func<Task<string>> callback, string unexpectedUrl, ILogger logger, string provider)
    {
        try
        {
            return await callback();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Error inesperado en la vuelta de {Provider}.", provider);
            return unexpectedUrl;
        }
    }
}
