using Google.Apis.Auth.OAuth2.Responses;
using Google.Apis.Json;
using Google.Apis.YouTube.v3;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.External.YouTube;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Application.Services;

/// <summary>
/// Canales de YouTube: Connect devuelve la URL de Google y Callback
/// (anónimo) canjea el código, identifica el canal con channels.list?mine=true y lo añade. Si el canal ya
/// estaba conectado, se reconecta en su misma fila y lo que esperaba la reconexión continúa.
/// </summary>
public sealed class YoutubeAccountService(
        GoogleOAuthClient oauth,
        YoutubeClientFactory clients,
        ConnectionRepository connections,
        ActivityRepository activity,
        SecretProtector protector,
        IProgressNotifier notifier,
        IOptions<AppSettings> appSettings,
        IOptions<AuthSettings> authSettings,
        ExceptionHelper exception,
        ILogger<YoutubeAccountService> logger)
{
    private const string ResultParameter = "youtubeAccount";

    public Task<CustomTransactionResponse<UrlResponse>> Connect(OAuthConnectQuery query, int userId, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<UrlResponse>>(async () =>
        {
            var google = await oauth.SettingsAsync(cancellationToken);
            if (!google.IsConfigured)
                return CustomTransactionResponse<UrlResponse>.Fail("Falta configurar el cliente de Google (Ajustes › Plataformas). Revisa los pasos 1 a 6 de la guía.");

            if (OAuthAccounts.CreateState(GoogleOAuthClient.StatePurpose, userId, query.ReturnUrl, google.ClientSecret) is not { } state)
                return CustomTransactionResponse<UrlResponse>.Fail(OAuthAccounts.InvalidReturnUrl);
            return CustomTransactionResponse<UrlResponse>.Ok(new UrlResponse { Url = GoogleOAuthClient.BuildAuthorizeUrl(google, state) });
        });

    /// <summary>Vuelta del OAuth: URL del front con ?youtubeAccount=connected|reconnected|error&amp;reason=…</summary>
    public Task<string> Callback(OAuthCallbackQuery query, CancellationToken cancellationToken) =>
        OAuthAccounts.SafeCallbackAsync(() => CallbackCoreAsync(query, cancellationToken), Back(OAuthAccounts.DefaultReturnUrl, "unexpected"), logger, "Google");

    private async Task<string> CallbackCoreAsync(OAuthCallbackQuery query, CancellationToken cancellationToken)
    {
        var google = await oauth.SettingsAsync(cancellationToken);
        if (!google.IsConfigured) return Back(OAuthAccounts.DefaultReturnUrl, "not_configured");

        if (!OAuthState.TryRead(GoogleOAuthClient.StatePurpose, query.State, google.ClientSecret, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), out _, out string returnUrl, out string? stateError))
        {
            logger.LogWarning("Vuelta de Google con estado no válido: {Reason}.", stateError);
            return Back(OAuthAccounts.DefaultReturnUrl, stateError ?? "invalid_state");
        }

        if (!string.IsNullOrWhiteSpace(query.Error))
            return Back(returnUrl, query.Error == "access_denied" ? "access_denied" : "denied");
        if (string.IsNullOrWhiteSpace(query.Code))
            return Back(returnUrl, "missing_code");

        TokenResponse token;
        try
        {
            var flow = await oauth.ExchangeFlowAsync(cancellationToken);
            token = await flow.ExchangeCodeForTokenAsync("pending", query.Code, google.RedirectUri, cancellationToken);
        }
        catch (TokenResponseException ex)
        {
            logger.LogWarning("Google rechazó el canje del código: {Error}.", ex.Error?.Error);
            return Back(returnUrl, "token");
        }

        // Consentimiento granular: la persona pudo desmarcar el permiso de subida.
        if (token.Scope?.Contains(YouTubeService.Scope.YoutubeUpload) != true) return Back(returnUrl, "missing_upload_scope");
        if (string.IsNullOrEmpty(token.RefreshToken)) return Back(returnUrl, "no_refresh_token");

        Google.Apis.YouTube.v3.Data.Channel? channel;
        using (var youtube = await clients.CreateForTokenAsync(token, cancellationToken))
        {
            var request = youtube.Channels.List("snippet");
            request.Mine = true;
            var response = await request.ExecuteAsync(cancellationToken);
            await activity.QuotaAdd(QuotaBuckets.General, 1, 0, CancellationToken.None);
            channel = response.Items?.FirstOrDefault();
        }
        if (channel == null) return Back(returnUrl, "no_channel");

        var saved = await connections.Save(new ConnectionSave(
            Platforms.YouTube,
            $"YT-{Guid.NewGuid():N}",
            channel.Id,
            channel.Snippet?.Title ?? channel.Id,
            channel.Snippet?.Thumbnails?.Default__?.Url,
            channel.Snippet?.CustomUrl,
            token.Scope,
            null,
            protector.Protect(NewtonsoftJsonSerializer.Instance.Serialize(token)),
            authSettings.Value.AdminUser), cancellationToken);

        logger.LogInformation("Canal de YouTube {Action}: {Channel} ({ChannelId}).", saved?.IsNew == false ? "reconectado" : "añadido", channel.Snippet?.Title, channel.Id);
        await notifier.ConnectionChangedAsync(Platforms.YouTube, cancellationToken);
        return Back(returnUrl, null, saved?.IsNew == false ? "reconnected" : "connected");
    }

    private string Back(string returnUrl, string? reason, string result = "connected") =>
        OAuthState.BackUrl(appSettings.Value.FrontBaseUrl, returnUrl, ResultParameter, reason, result);
}
