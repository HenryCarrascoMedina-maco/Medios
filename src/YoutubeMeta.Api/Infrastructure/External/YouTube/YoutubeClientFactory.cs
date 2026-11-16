using Google.Apis.Auth.OAuth2;
using Google.Apis.Auth.OAuth2.Responses;
using Google.Apis.Http;
using Google.Apis.Services;
using Google.Apis.YouTube.v3;

namespace YoutubeMeta.Api.Infrastructure.External.YouTube;

public sealed class YoutubeClientFactory(GoogleOAuthClient oauth)
{
    /// <summary>Cliente con el token guardado de la conexión; null si no hay token (hay que reconectar).</summary>
    public async Task<YouTubeService?> CreateAsync(string connectionKey, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var flow = await oauth.StoredFlowAsync(cancellationToken);
        TokenResponse? token = await flow.LoadTokenAsync(connectionKey, cancellationToken);
        if (token is null) return null;

        var settings = await oauth.SettingsAsync(cancellationToken);
        return Create(new UserCredential(flow, connectionKey, token), settings.ApplicationName, timeout);
    }

    /// <summary>Cliente con un token recién canjeado en el callback (todavía sin fila).</summary>
    public async Task<YouTubeService> CreateForTokenAsync(TokenResponse token, CancellationToken cancellationToken)
    {
        var flow = await oauth.ExchangeFlowAsync(cancellationToken);
        var settings = await oauth.SettingsAsync(cancellationToken);
        return Create(new UserCredential(flow, "pending", token), settings.ApplicationName, TimeSpan.FromSeconds(100));
    }

    private static YouTubeService Create(UserCredential credential, string applicationName, TimeSpan timeout)
    {
        var service = new YouTubeService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = applicationName,
            DefaultExponentialBackOffPolicy = ExponentialBackOffPolicy.Exception | ExponentialBackOffPolicy.UnsuccessfulResponse503
        });
        // Se aplica a cada petición, es decir a cada chunk de la subida, no al archivo completo.
        service.HttpClient.Timeout = timeout;
        return service;
    }
}
