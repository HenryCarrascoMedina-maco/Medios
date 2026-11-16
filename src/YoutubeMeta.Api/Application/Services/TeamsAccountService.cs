using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.External;
using YoutubeMeta.Api.Infrastructure.External.Teams;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;

#region RESPONSES
using SaveResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.AccountSaveResult>>;
#endregion

namespace YoutubeMeta.Api.Application.Services;

/// <summary>
/// Canales de Microsoft Teams. Dos formas de conectarlos:
/// <list type="bullet">
/// <item>Microsoft Graph (recomendada): inicio de sesión con la cuenta de trabajo; la vuelta guarda el token unos
/// minutos con un código («pick») y la persona elige los canales. Cada canal es una cuenta con su copia del token.</item>
/// <item>Webhook de Workflows: se pega la URL que da Teams; solo texto, enlace e imágenes por URL pública.</item>
/// </list>
/// </summary>
public sealed class TeamsAccountService(
        TeamsClient teams,
        TeamsTokens tokens,
        PlatformKeys keys,
        ConnectionRepository connections,
        SecretProtector protector,
        IMemoryCache cache,
        IProgressNotifier notifier,
        IOptions<AppSettings> appSettings,
        ExceptionHelper exception,
        ILogger<TeamsAccountService> logger)
{
    public const string GraphHint = "Canal de Teams";
    public const string WebhookHint = "Canal (webhook)";
    private const string ResultParameter = "teamsAccount";
    private static readonly TimeSpan PickLifetime = TimeSpan.FromMinutes(10);
    private static readonly string[] WebhookHosts = ["logic.azure.com", "powerplatform.com", "powerautomate.com"];

    private sealed record Pick(TeamsToken Token, TeamsUser User);

    public Task<CustomTransactionResponse<UrlResponse>> Connect(OAuthConnectQuery query, int userId, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<UrlResponse>>(async () =>
        {
            var app = (await keys.TeamsAsync(cancellationToken)).Settings;
            if (!app.IsConfigured)
                return CustomTransactionResponse<UrlResponse>.Fail("Falta configurar la app de Microsoft Entra (Ajustes › Plataformas › Teams): Id. de aplicación, Id. de directorio y secreto. Revisa la guía de Teams.");

            // Con «Leer respuestas» se pide también ChannelMessage.Read.All (bandeja); el propósito del state lo recuerda.
            string purpose = query.Inbox ? TeamsClient.InboxStatePurpose : TeamsClient.StatePurpose;
            if (OAuthAccounts.CreateState(purpose, userId, query.ReturnUrl, app.ClientSecret) is not { } state)
                return CustomTransactionResponse<UrlResponse>.Fail(OAuthAccounts.InvalidReturnUrl);
            return CustomTransactionResponse<UrlResponse>.Ok(new UrlResponse
            {
                Url = TeamsClient.BuildAuthorizeUrl(app, state, query.Inbox ? TeamsClient.InboxScopes : TeamsClient.Scopes)
            });
        });

    /// <summary>Vuelta de Microsoft: ?teamsAccount=pick&amp;pick=… para elegir canales, o error con el motivo.</summary>
    public Task<string> Callback(OAuthCallbackQuery query, CancellationToken cancellationToken) =>
        OAuthAccounts.SafeCallbackAsync(() => CallbackCoreAsync(query, cancellationToken), Back(OAuthAccounts.DefaultReturnUrl, "unexpected"), logger, "Microsoft (Teams)");

    private async Task<string> CallbackCoreAsync(OAuthCallbackQuery query, CancellationToken cancellationToken)
    {
        var app = (await keys.TeamsAsync(cancellationToken)).Settings;
        if (!app.IsConfigured) return Back(OAuthAccounts.DefaultReturnUrl, "not_configured");

        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        bool inbox = OAuthState.TryRead(TeamsClient.InboxStatePurpose, query.State, app.ClientSecret, now, out _, out string returnUrl, out string? stateError);
        if (!inbox && !OAuthState.TryRead(TeamsClient.StatePurpose, query.State, app.ClientSecret, now, out _, out returnUrl, out stateError))
        {
            logger.LogWarning("Vuelta de Microsoft con estado no válido: {Reason}.", stateError);
            return Back(OAuthAccounts.DefaultReturnUrl, stateError ?? "invalid_state");
        }

        if (!string.IsNullOrWhiteSpace(query.Error))
        {
            logger.LogWarning("Microsoft devolvió {Error}: {Description}", query.Error, query.ErrorDescription);
            return Back(returnUrl, ReasonFor(query.Error, query.ErrorDescription));
        }
        if (string.IsNullOrWhiteSpace(query.Code)) return Back(returnUrl, "missing_code");

        var token = await teams.ExchangeCodeAsync(app, query.Code, cancellationToken, inbox ? TeamsClient.InboxScopes : TeamsClient.Scopes);
        if (!token.Ok)
        {
            logger.LogWarning("Microsoft rechazó el canje del código: {Code}.", token.Error!.Code);
            return Back(returnUrl, ReasonFor(token.Error.Code, token.Error.Message) is var r && r != "denied" ? r : "token");
        }
        if (!token.Data!.Scope.Contains("ChannelMessage.Send", StringComparison.OrdinalIgnoreCase)) return Back(returnUrl, "missing_scope");

        var me = await teams.MeAsync(token.Data.AccessToken, cancellationToken);
        if (!me.Ok) return Back(returnUrl, "token");

        string pick = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        cache.Set(CacheKey(pick), new Pick(token.Data, me.Data!), PickLifetime);
        return OAuthState.BackUrl(appSettings.Value.FrontBaseUrl, returnUrl, ResultParameter, null, $"pick&pick={pick}");
    }

    /// <summary>
    /// Traduce los errores de Entra: AADSTS65001/90094 = hace falta consentimiento de un administrador;
    /// AADSTS50020/90072 o cuentas MSA = cuenta personal de Microsoft.
    /// </summary>
    public static string ReasonFor(string? error, string? description)
    {
        string text = $"{error} {description}";
        if (text.Contains("AADSTS65001") || text.Contains("AADSTS90094") || text.Contains("admin", StringComparison.OrdinalIgnoreCase)) return "admin_consent";
        if (text.Contains("AADSTS50020") || text.Contains("AADSTS90072") || text.Contains("AADSTS50194") || text.Contains("Microsoft Account", StringComparison.OrdinalIgnoreCase))
            return "personal_account";
        if (error is "access_denied" || text.Contains("AADSTS65004")) return "access_denied";
        return "denied";
    }

    /// <summary>Equipos y canales de la cuenta recién conectada, con los que ya están conectados marcados.</summary>
    public Task<CustomTransactionResponse<TeamsChannelsResponse>> Channels(string pick, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<TeamsChannelsResponse>>(async () =>
        {
            if (!cache.TryGetValue(CacheKey(pick), out Pick? data) || data is null)
                return CustomTransactionResponse<TeamsChannelsResponse>.Fail("Pasaron más de 10 minutos desde que iniciaste sesión. Pulsa «Conectar Teams» otra vez.");

            var list = await teams.TeamsAsync(data.Token.AccessToken, cancellationToken);
            if (!list.Ok) return CustomTransactionResponse<TeamsChannelsResponse>.Fail(Friendly(list.Error!));
            if (list.Data!.Count == 0) return CustomTransactionResponse<TeamsChannelsResponse>.Fail("Tu cuenta no pertenece a ningún equipo de Teams.");

            var connected = (await connections.List(cancellationToken))
                .Where(c => c.Platform == Platforms.Teams && c.StatusCode == ConnectionStatus.Connected)
                .Select(c => c.ExternalId).ToHashSet();

            return CustomTransactionResponse<TeamsChannelsResponse>.Ok(new TeamsChannelsResponse
            {
                Account = new TeamsAccountInfo { Name = data.User.Name, Email = data.User.Email },
                Teams = [.. list.Data.Select(t => new TeamsTeamOption
                {
                    Id = t.Id,
                    Name = t.Name,
                    Channels = [.. t.Channels.Select(c => new TeamsChannelOption
                    {
                        Id = c.Id,
                        Name = c.Name,
                        MembershipType = c.MembershipType,
                        Connected = connected.Contains(ExternalId(t.Id, c.Id))
                    })]
                })]
            });
        });

    /// <summary>Guarda los canales elegidos. Cada uno guarda su copia del token (se renueva por separado).</summary>
    public Task<SaveResponse> Save(TeamsChannelsSaveRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<SaveResponse>(async () =>
        {
            if (!cache.TryGetValue(CacheKey(request.Pick), out Pick? data) || data is null)
                return SaveResponse.Fail("Pasaron más de 10 minutos desde que iniciaste sesión. Pulsa «Conectar Teams» otra vez.");
            if (request.Channels.Count == 0) return SaveResponse.Fail("Marca al menos un canal.");

            var list = await teams.TeamsAsync(data.Token.AccessToken, cancellationToken);
            if (!list.Ok) return SaveResponse.Fail(Friendly(list.Error!));

            var credentialId = (await keys.TeamsAsync(cancellationToken)).CredentialId;
            string cipher = tokens.Protect(data.Token);
            var results = new List<AccountSaveResult>();
            foreach (var pickRef in request.Channels.DistinctBy(c => (c.TeamId, c.ChannelId)))
            {
                var team = list.Data!.FirstOrDefault(t => t.Id == pickRef.TeamId);
                var channel = team?.Channels.FirstOrDefault(c => c.Id == pickRef.ChannelId);
                var result = new AccountSaveResult { Name = team is null || channel is null ? pickRef.ChannelId : $"{team.Name} › {channel.Name}" };
                results.Add(result);
                if (team is null || channel is null) { result.Error = "Ya no tienes acceso a este canal."; continue; }

                var saved = await connections.Save(new ConnectionSave(
                    Platforms.Teams, $"TM-{Guid.NewGuid():N}", ExternalId(team.Id, channel.Id), result.Name, null,
                    GraphHint, data.Token.Scope, null, cipher, userName, credentialId, new ConnectionExtra { UserId = data.User.Id }.ToJson()), cancellationToken);
                result.ConnectionId = saved?.Id;
                result.IsNew = saved?.IsNew ?? false;
            }

            logger.LogInformation("Teams: {Count} canal(es) conectados por {User}.", results.Count(r => r.ConnectionId != null), data.User.Email);
            await notifier.ConnectionChangedAsync(Platforms.Teams, cancellationToken);
            return SaveResponse.Ok(results);
        });

    /// <summary>Canal por webhook de Workflows. La URL se guarda cifrada (quien la tenga puede escribir en el canal).</summary>
    public Task<CustomTransactionResponse<int>> SaveWebhook(TeamsWebhookSaveRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<int>>(async () =>
        {
            string name = request.Name?.Trim() ?? string.Empty;
            string url = request.Url?.Trim() ?? string.Empty;
            if (name.Length is 0 or > 100) return CustomTransactionResponse<int>.Fail("Ponle un nombre al canal (hasta 100 caracteres).");
            if (ValidateWebhookUrl(url) is { } error) return CustomTransactionResponse<int>.Fail(error);

            string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(url)))[..16].ToLowerInvariant();
            var saved = await connections.Save(new ConnectionSave(
                Platforms.Teams, $"TW-{Guid.NewGuid():N}", Platforms.TeamsWebhookPrefix + hash, name, null,
                WebhookHint, null, null, protector.Protect(url), userName), cancellationToken);

            await notifier.ConnectionChangedAsync(Platforms.Teams, cancellationToken);
            return saved?.Id is { } id ? CustomTransactionResponse<int>.Ok(id) : CustomTransactionResponse<int>.Fail("No se pudo guardar el canal.");
        });

    /// <summary>Solo URLs https de Workflows (Power Automate / Logic Apps). Los antiguos conectores de Office 365 ya no existen.</summary>
    public static string? ValidateWebhookUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            return "La URL del webhook debe empezar por https://. Cópiala entera desde el flujo de trabajo de Teams.";
        if (uri.Host.EndsWith("webhook.office.com", StringComparison.OrdinalIgnoreCase))
            return "Esa URL es de un conector de Office 365, que Microsoft retiró en 2026. Crea un flujo de trabajo nuevo (ver la guía de Teams, forma B).";
        if (!WebhookHosts.Any(h => uri.Host.EndsWith(h, StringComparison.OrdinalIgnoreCase)))
            return "No parece una URL de un flujo de trabajo de Teams (suele contener logic.azure.com o powerplatform.com). Revisa la guía.";
        return null;
    }

    public static string ExternalId(string teamId, string channelId) => $"{teamId}/{channelId}";

    internal static string Friendly(TeamsError error) => error.HttpStatus switch
    {
        401 => TeamsTokens.RejectedMessage,
        403 => "Microsoft no dio permiso. Revisa los permisos de la app en Entra (ver la guía) o pide a TI que la apruebe.",
        _ => string.IsNullOrWhiteSpace(error.Message) ? $"Microsoft respondió con un error ({error.HttpStatus})." : error.Message
    };

    private static string CacheKey(string pick) => $"teams-pick:{pick}";

    private string Back(string returnUrl, string? reason) =>
        OAuthState.BackUrl(appSettings.Value.FrontBaseUrl, returnUrl, ResultParameter, reason);
}
