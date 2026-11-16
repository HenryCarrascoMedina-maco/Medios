using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.External;
using YoutubeMeta.Api.Infrastructure.External.Linkedin;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Application.Services;

/// <summary>
/// Cuentas de LinkedIn, con dos formas de conectar (mismo esquema OAuth que YouTube y TikTok):
/// <list type="bullet">
/// <item>Perfil personal: app con «Share on LinkedIn»; se publica como la persona.</item>
/// <item>Página de empresa: otra app, con la Community Management API (la aprueba LinkedIn); se conectan todas las
/// páginas que la persona administra y luego se quitan las que no se quieran.</item>
/// </list>
/// Al publicar no cambia nada: el autor del post sale del ExternalId de la cuenta (urn:li:person o urn:li:organization).
/// </summary>
public sealed class LinkedinAccountService(
        LinkedinClient linkedin,
        LinkedinTokens tokens,
        PlatformKeys keys,
        ConnectionRepository connections,
        IProgressNotifier notifier,
        IOptions<AppSettings> appSettings,
        IOptions<AuthSettings> authSettings,
        ExceptionHelper exception,
        ILogger<LinkedinAccountService> logger)
{
    public const string PersonHint = "Perfil personal";
    public const string OrganizationHint = "Página de empresa";
    private const string ResultParameter = "linkedinAccount";

    public Task<CustomTransactionResponse<UrlResponse>> Connect(bool organization, OAuthConnectQuery query, int userId, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<UrlResponse>>(async () =>
        {
            var app = (await keys.LinkedinAsync(organization, cancellationToken)).Settings;
            if (!app.IsConfigured)
                return CustomTransactionResponse<UrlResponse>.Fail(organization
                    ? "Falta configurar la app de LinkedIn para páginas de empresa (Ajustes › Plataformas). Revisa la guía de LinkedIn, parte B."
                    : "Falta configurar la app de LinkedIn (Ajustes › Plataformas) y su URL de retorno. Revisa la guía de LinkedIn.");

            if (OAuthAccounts.CreateState(Purpose(organization), userId, query.ReturnUrl, app.ClientSecret) is not { } state)
                return CustomTransactionResponse<UrlResponse>.Fail(OAuthAccounts.InvalidReturnUrl);
            return CustomTransactionResponse<UrlResponse>.Ok(new UrlResponse { Url = LinkedinClient.BuildAuthorizeUrl(app, state) });
        });

    /// <summary>Vuelta del OAuth: URL del front con ?linkedinAccount=connected|reconnected|error&amp;reason=…</summary>
    public Task<string> Callback(bool organization, OAuthCallbackQuery query, CancellationToken cancellationToken) =>
        OAuthAccounts.SafeCallbackAsync(() => CallbackCoreAsync(organization, query, cancellationToken), Back(OAuthAccounts.DefaultReturnUrl, "unexpected"), logger, "LinkedIn");

    private async Task<string> CallbackCoreAsync(bool organization, OAuthCallbackQuery query, CancellationToken cancellationToken)
    {
        var resolved = await keys.LinkedinAsync(organization, cancellationToken);
        var app = resolved.Settings;
        if (!app.IsConfigured) return Back(OAuthAccounts.DefaultReturnUrl, "not_configured");

        if (!OAuthState.TryRead(Purpose(organization), query.State, app.ClientSecret, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), out _, out string returnUrl, out string? stateError))
        {
            logger.LogWarning("Vuelta de LinkedIn con estado no válido: {Reason}.", stateError);
            return Back(OAuthAccounts.DefaultReturnUrl, stateError ?? "invalid_state");
        }

        if (!string.IsNullOrWhiteSpace(query.Error))
            return Back(returnUrl, query.Error is "user_cancelled_login" or "user_cancelled_authorize" or "access_denied" ? "access_denied" : "denied");
        if (string.IsNullOrWhiteSpace(query.Code)) return Back(returnUrl, "missing_code");

        var token = await linkedin.ExchangeCodeAsync(app, query.Code, cancellationToken);
        if (!token.Ok)
        {
            logger.LogWarning("LinkedIn rechazó el canje del código: {Code} (HTTP {Status}).", token.Error!.Code, token.Error.HttpStatus);
            return Back(returnUrl, "token");
        }

        string[] granted = token.Data!.Scope.Split([',', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (!granted.Contains(organization ? "w_organization_social" : "w_member_social")) return Back(returnUrl, "missing_scope");

        string cipher = tokens.Protect(token.Data);
        bool anyNew = false;

        if (organization)
        {
            var pages = await linkedin.OrganizationsAsync(token.Data.AccessToken, app.ApiVersion, cancellationToken);
            if (!pages.Ok)
            {
                logger.LogWarning("LinkedIn no devolvió las páginas administradas: {Code}.", pages.Error!.Code);
                return Back(returnUrl, "no_pages");
            }
            if (pages.Data!.Count == 0) return Back(returnUrl, "no_pages");

            foreach (var page in pages.Data)
            {
                var saved = await SaveAsync(page.Urn, page.Name, null, OrganizationHint, token.Data, cipher, resolved.CredentialId, cancellationToken);
                anyNew |= saved?.IsNew != false;
            }
            logger.LogInformation("LinkedIn: {Count} páginas de empresa conectadas.", pages.Data.Count);
        }
        else
        {
            var member = await linkedin.MemberAsync(token.Data.AccessToken, app.ApiVersion, cancellationToken);
            if (!member.Ok || member.Data!.Id.Length == 0) return Back(returnUrl, "no_channel");

            var saved = await SaveAsync($"urn:li:person:{member.Data.Id}", member.Data.Name.Length > 0 ? member.Data.Name : "Perfil de LinkedIn",
                member.Data.PictureUrl, PersonHint, token.Data, cipher, resolved.CredentialId, cancellationToken);
            anyNew = saved?.IsNew != false;
            logger.LogInformation("Perfil de LinkedIn {Action}.", anyNew ? "añadido" : "reconectado");
        }

        await notifier.ConnectionChangedAsync(Platforms.LinkedIn, cancellationToken);
        return Back(returnUrl, null, anyNew ? "connected" : "reconnected");
    }

    private Task<ConnectionSaved?> SaveAsync(string externalId, string name, string? avatar, string hint, LinkedinToken token, string cipher, int? credentialId, CancellationToken cancellationToken) =>
        connections.Save(new ConnectionSave(
            Platforms.LinkedIn,
            $"LI-{Guid.NewGuid():N}",
            externalId,
            name,
            avatar,
            hint,
            token.Scope,
            token.ExpiresAtUtc,
            cipher,
            authSettings.Value.AdminUser,
            credentialId), cancellationToken);

    private static string Purpose(bool organization) => organization ? LinkedinClient.OrgStatePurpose : LinkedinClient.StatePurpose;

    private string Back(string returnUrl, string? reason, string result = "connected") =>
        OAuthState.BackUrl(appSettings.Value.FrontBaseUrl, returnUrl, ResultParameter, reason, result);
}
