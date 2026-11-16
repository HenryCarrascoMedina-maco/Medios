using System.Collections.Concurrent;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Auth.OAuth2.Flows;
using Google.Apis.YouTube.v3;
using Microsoft.AspNetCore.WebUtilities;

namespace YoutubeMeta.Api.Infrastructure.External.YouTube;

/// <summary>
/// OAuth de Google (flujo web server). Dos flows por cliente: uno sin almacén para canjear el código en
/// el callback (la conexión todavía no existe) y otro con <see cref="DbTokenDataStore"/> para el uso
/// diario, que persiste cada refresco del access token. El cliente (Client ID y secreto) puede cambiar
/// desde Ajustes: los flows se crean por cliente y se reutilizan mientras no cambie.
/// </summary>
public sealed class GoogleOAuthClient(PlatformKeys keys, IHttpClientFactory httpClientFactory, DbTokenDataStore dataStore) : IDisposable
{
    public const string StatePurpose = "youtube-account-state";
    /// <summary>youtube.force-ssl: leer y responder comentarios (bandeja). Los canales conectados antes deben reconectarse.</summary>
    public static readonly string[] Scopes = [YouTubeService.Scope.YoutubeUpload, YouTubeService.Scope.YoutubeReadonly, YouTubeService.Scope.YoutubeForceSsl];

    private const string AuthorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    private const string RevokeEndpoint = "https://oauth2.googleapis.com/revoke";

    private sealed record Flows(GoogleAuthorizationCodeFlow Exchange, GoogleAuthorizationCodeFlow Stored);

    private readonly ConcurrentDictionary<string, Flows> _flows = new();

    public async Task<GoogleSettings> SettingsAsync(CancellationToken cancellationToken) =>
        (await keys.GoogleAsync(cancellationToken)).Settings;

    public async Task<GoogleAuthorizationCodeFlow> ExchangeFlowAsync(CancellationToken cancellationToken) =>
        FlowsFor(await SettingsAsync(cancellationToken)).Exchange;

    public async Task<GoogleAuthorizationCodeFlow> StoredFlowAsync(CancellationToken cancellationToken) =>
        FlowsFor(await SettingsAsync(cancellationToken)).Stored;

    /// <summary>
    /// prompt=consent garantiza refresh_token en cada conexión; select_account obliga a elegir
    /// cuenta o Brand Account: así se añade cada canal.
    /// </summary>
    public static string BuildAuthorizeUrl(GoogleSettings settings, string state) =>
        QueryHelpers.AddQueryString(AuthorizeEndpoint, new Dictionary<string, string?>
        {
            ["client_id"] = settings.ClientId,
            ["redirect_uri"] = settings.RedirectUri,
            ["response_type"] = "code",
            ["scope"] = string.Join(' ', Scopes),
            ["access_type"] = "offline",
            ["include_granted_scopes"] = "true",
            ["prompt"] = "consent select_account",
            ["state"] = state
        });

    public async Task<bool> RevokeAsync(string token, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.Google);
        using var response = await client.PostAsync(RevokeEndpoint,
            new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = token }), cancellationToken);
        return response.IsSuccessStatusCode;
    }

    // Al cambiar de cliente no se desechan los flows anteriores: puede haber una subida usándolos.
    private Flows FlowsFor(GoogleSettings settings) =>
        _flows.GetOrAdd($"{settings.ClientId}\n{settings.ClientSecret}", _ => new Flows(CreateFlow(settings, null), CreateFlow(settings, dataStore)));

    private static GoogleAuthorizationCodeFlow CreateFlow(GoogleSettings settings, DbTokenDataStore? store) =>
        new(new GoogleAuthorizationCodeFlow.Initializer
        {
            ClientSecrets = new ClientSecrets { ClientId = settings.ClientId, ClientSecret = settings.ClientSecret },
            Scopes = Scopes,
            DataStore = store,
            Prompt = "consent",
            IncludeGrantedScopes = true
        });

    public void Dispose()
    {
        foreach (var flows in _flows.Values)
        {
            flows.Exchange.Dispose();
            flows.Stored.Dispose();
        }
    }
}
