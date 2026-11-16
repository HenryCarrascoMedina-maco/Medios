using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.External;
using YoutubeMeta.Api.Infrastructure.External.Tiktok;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Application.Services;

/// <summary>
/// Cuentas de TikTok con Login Kit (mismo esquema que YouTube): Connect devuelve la URL de TikTok y el
/// Callback anónimo canjea el código, lee el perfil y añade o reconecta la cuenta.
/// </summary>
public sealed class TiktokAccountService(
        TiktokClient tiktok,
        TiktokTokens tokens,
        PlatformKeys keys,
        ConnectionRepository connections,
        IProgressNotifier notifier,
        IOptions<AppSettings> appSettings,
        IOptions<AuthSettings> authSettings,
        ExceptionHelper exception,
        ILogger<TiktokAccountService> logger)
{
    private const string ResultParameter = "tiktokAccount";

    public Task<CustomTransactionResponse<UrlResponse>> Connect(OAuthConnectQuery query, int userId, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<UrlResponse>>(async () =>
        {
            var settings = (await keys.TiktokAsync(cancellationToken)).Settings;
            if (!settings.IsConfigured)
                return CustomTransactionResponse<UrlResponse>.Fail("Falta configurar el cliente de TikTok (Ajustes › Plataformas) y su RedirectUri https. Revisa la guía de TikTok.");

            if (OAuthAccounts.CreateState(TiktokClient.StatePurpose, userId, query.ReturnUrl, settings.ClientSecret) is not { } state)
                return CustomTransactionResponse<UrlResponse>.Fail(OAuthAccounts.InvalidReturnUrl);
            return CustomTransactionResponse<UrlResponse>.Ok(new UrlResponse { Url = TiktokClient.BuildAuthorizeUrl(settings, state) });
        });

    /// <summary>Vuelta del OAuth: URL del front con ?tiktokAccount=connected|reconnected|error&amp;reason=…</summary>
    public Task<string> Callback(OAuthCallbackQuery query, CancellationToken cancellationToken) =>
        OAuthAccounts.SafeCallbackAsync(() => CallbackCoreAsync(query, cancellationToken), Back(OAuthAccounts.DefaultReturnUrl, "unexpected"), logger, "TikTok");

    private async Task<string> CallbackCoreAsync(OAuthCallbackQuery query, CancellationToken cancellationToken)
    {
        var settings = (await keys.TiktokAsync(cancellationToken)).Settings;
        if (!settings.IsConfigured) return Back(OAuthAccounts.DefaultReturnUrl, "not_configured");

        if (!OAuthState.TryRead(TiktokClient.StatePurpose, query.State, settings.ClientSecret, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), out _, out string returnUrl, out string? stateError))
        {
            logger.LogWarning("Vuelta de TikTok con estado no válido: {Reason}.", stateError);
            return Back(OAuthAccounts.DefaultReturnUrl, stateError ?? "invalid_state");
        }

        if (!string.IsNullOrWhiteSpace(query.Error))
            return Back(returnUrl, query.Error == "access_denied" ? "access_denied" : "denied");
        if (string.IsNullOrWhiteSpace(query.Code))
            return Back(returnUrl, "missing_code");

        var token = await tiktok.ExchangeCodeAsync(settings, query.Code, cancellationToken);
        if (!token.Ok)
        {
            logger.LogWarning("TikTok rechazó el canje del código: {Error}.", token.Error!.Code);
            return Back(returnUrl, "token");
        }

        // Sin video.publish no se puede publicar directo; sin video.upload, tampoco como borrador.
        string[] granted = token.Data!.Scope.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (!granted.Contains("video.publish") && !granted.Contains("video.upload")) return Back(returnUrl, "missing_upload_scope");

        var user = await tiktok.UserInfoAsync(token.Data.AccessToken, cancellationToken);
        if (!user.Ok) return Back(returnUrl, "no_channel");

        var saved = await connections.Save(new ConnectionSave(
            Platforms.TikTok,
            $"TT-{Guid.NewGuid():N}",
            token.Data.OpenId,
            user.Data!.DisplayName.Length > 0 ? user.Data.DisplayName : user.Data.Username,
            TextHelper.NullIfBlank(user.Data.AvatarUrl),
            user.Data.Username.Length > 0 ? $"@{user.Data.Username}" : null,
            token.Data.Scope,
            token.Data.RefreshExpiresAtUtc,
            tokens.Protect(token.Data),
            authSettings.Value.AdminUser), cancellationToken);

        logger.LogInformation("Cuenta de TikTok {Action}: @{User}.", saved?.IsNew == false ? "reconectada" : "añadida", user.Data.Username);
        await notifier.ConnectionChangedAsync(Platforms.TikTok, cancellationToken);
        return Back(returnUrl, null, saved?.IsNew == false ? "reconnected" : "connected");
    }

    /// <summary>Lo que TikTok exige mostrar antes de publicar: apodo, privacidades permitidas e interacciones.</summary>
    public Task<CustomTransactionResponse<TiktokCreatorInfo>> CreatorInfo(int connectionId, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<TiktokCreatorInfo>>(async () =>
        {
            var connection = await connections.Get(connectionId, cancellationToken);
            if (connection?.Platform != Platforms.TikTok) return CustomTransactionResponse<TiktokCreatorInfo>.Fail("La cuenta de TikTok no existe.");

            var access = await tokens.AccessTokenAsync(connection.ConnectionKey, cancellationToken);
            if (access.Token is not { } accessToken)
                return CustomTransactionResponse<TiktokCreatorInfo>.Fail(access.IsTransientFailure
                    ? "TikTok no responde ahora mismo. Prueba de nuevo en unos minutos."
                    : "TikTok rechazó el acceso. Vuelve a conectar la cuenta.");

            var info = await tiktok.CreatorInfoAsync(accessToken, cancellationToken);
            return info.Ok
                ? CustomTransactionResponse<TiktokCreatorInfo>.Ok(info.Data!)
                : CustomTransactionResponse<TiktokCreatorInfo>.Fail(TiktokPublisher.Friendly(info.Error!));
        });

    private string Back(string returnUrl, string? reason, string result = "connected") =>
        OAuthState.BackUrl(appSettings.Value.FrontBaseUrl, returnUrl, ResultParameter, reason, result);
}
