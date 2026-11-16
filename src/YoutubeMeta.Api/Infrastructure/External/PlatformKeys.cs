using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Infrastructure.External;

/// <summary>
/// Claves de las apps de cada plataforma: las guardadas en Ajustes (cifradas en BD) y, si no hay, las de
/// configuración (user-secrets o variables de IIS). Se cachean en memoria y se invalidan al guardar.
/// La RedirectUri siempre sale de la configuración: depende del servidor, no de la cuenta.
/// </summary>
public sealed class PlatformKeys(
        CredentialRepository credentials,
        SecretProtector protector,
        IOptions<GoogleSettings> google,
        IOptions<TiktokSettings> tiktok,
        IOptions<LinkedinSettings> linkedin,
        IOptions<TeamsSettings> teams,
        IOptions<MetaSettings> meta,
        IOptions<AppSettings> app)
{
    public const string MetaWebhookPath = "/api/Webhook/Meta";
    private ResolvedKey<MetaAppKeys>? _meta;

    public const string TeamsCallbackPath = "/api/Connection/Teams/Callback";
    private ResolvedKey<TeamsSettings>? _teams;

    public const string LinkedinCallbackPath = "/api/Connection/Linkedin/Callback";
    public const string LinkedinOrgCallbackPath = "/api/Connection/LinkedinOrg/Callback";

    private ResolvedKey<GoogleSettings>? _google;
    private ResolvedKey<TiktokSettings>? _tiktok;
    private ResolvedKey<LinkedinApp>? _linkedin;
    private ResolvedKey<LinkedinApp>? _linkedinOrg;

    public async Task<ResolvedKey<GoogleSettings>> GoogleAsync(CancellationToken cancellationToken) =>
        _google ??= await LoadAsync(Platforms.YouTube, google.Value, (s, id, secret) => new GoogleSettings
        {
            ClientId = id,
            ClientSecret = secret,
            RedirectUri = s.RedirectUri,
            RegionCode = s.RegionCode,
            ApplicationName = s.ApplicationName
        }, s => s.ClientId.Length > 0 && s.ClientSecret.Length > 0, cancellationToken);

    public async Task<ResolvedKey<TiktokSettings>> TiktokAsync(CancellationToken cancellationToken) =>
        _tiktok ??= await LoadAsync(Platforms.TikTok, tiktok.Value, (s, id, secret) => new TiktokSettings
        {
            ClientKey = id,
            ClientSecret = secret,
            RedirectUri = s.RedirectUri,
            ChunkMb = s.ChunkMb
        }, s => s.ClientKey.Length > 0 && s.ClientSecret.Length > 0, cancellationToken);

    /// <summary>
    /// App de LinkedIn para perfiles (<paramref name="organization"/> = false) o para páginas de empresa. La URL de
    /// retorno, si no está configurada, sale de App:PublicBaseUrl (LinkedIn exige https salvo en localhost).
    /// </summary>
    public async Task<ResolvedKey<LinkedinApp>> LinkedinAsync(bool organization, CancellationToken cancellationToken)
    {
        if (organization && _linkedinOrg != null) return _linkedinOrg;
        if (!organization && _linkedin != null) return _linkedin;

        var s = linkedin.Value;
        string redirect = organization ? s.OrgRedirectUri : s.RedirectUri;
        if (redirect.Length == 0 && app.Value.HasPublicBaseUrl)
            redirect = app.Value.PublicBaseUrl.TrimEnd('/') + (organization ? LinkedinOrgCallbackPath : LinkedinCallbackPath);

        var config = new LinkedinApp
        {
            ClientId = organization ? s.OrgClientId : s.ClientId,
            ClientSecret = organization ? s.OrgClientSecret : s.ClientSecret,
            RedirectUri = redirect,
            ApiVersion = s.ApiVersion,
            IsOrganization = organization
        };
        var resolved = await LoadAsync(organization ? Platforms.LinkedInOrgCredential : Platforms.LinkedIn, config, (c, id, secret) => new LinkedinApp
        {
            ClientId = id,
            ClientSecret = secret,
            RedirectUri = c.RedirectUri,
            ApiVersion = c.ApiVersion,
            IsOrganization = c.IsOrganization
        }, c => c.ClientId.Length > 0 && c.ClientSecret.Length > 0, cancellationToken);

        return organization ? _linkedinOrg = resolved : _linkedin = resolved;
    }

    /// <summary>
    /// App de Microsoft Entra para Teams. El inquilino y la caducidad del secreto van en Settings de la clave guardada.
    /// La URL de retorno, si no está configurada, sale de App:PublicBaseUrl.
    /// </summary>
    public async Task<ResolvedKey<TeamsSettings>> TeamsAsync(CancellationToken cancellationToken)
    {
        if (_teams != null) return _teams;
        var s = teams.Value;
        string redirect = s.RedirectUri.Length == 0 && app.Value.HasPublicBaseUrl ? app.Value.PublicBaseUrl.TrimEnd('/') + TeamsCallbackPath : s.RedirectUri;

        var row = await credentials.GetForPlatform(Platforms.Teams, cancellationToken);
        if (row is { PublicId: { Length: > 0 } publicId })
        {
            var options = CredentialSettings.Parse(row.Settings);
            return _teams = new(new TeamsSettings
            {
                TenantId = options.TenantId ?? s.TenantId,
                ClientId = publicId,
                ClientSecret = protector.Unprotect(row.SecretCipher),
                RedirectUri = redirect,
                SecretExpiresAt = options.SecretExpiresAt
            }, CredentialSources.Database, row.Id);
        }

        var config = new TeamsSettings { TenantId = s.TenantId, ClientId = s.ClientId, ClientSecret = s.ClientSecret, RedirectUri = redirect, SecretExpiresAt = s.SecretExpiresAt };
        return _teams = new(config, config.ClientId.Length > 0 && config.ClientSecret.Length > 0 ? CredentialSources.Config : CredentialSources.None, null);
    }

    /// <summary>App de Meta (bandeja): App ID y App Secret guardados en Ajustes; el texto de verificación va en Settings.</summary>
    public async Task<ResolvedKey<MetaAppKeys>> MetaAppAsync(CancellationToken cancellationToken)
    {
        if (_meta != null) return _meta;
        var row = await credentials.GetForPlatform(Platforms.MetaAppCredential, cancellationToken);
        if (row is { PublicId: { Length: > 0 } publicId })
            return _meta = new(new MetaAppKeys
            {
                AppId = publicId,
                AppSecret = protector.Unprotect(row.SecretCipher),
                VerifyToken = CredentialSettings.Parse(row.Settings).VerifyToken ?? string.Empty
            }, CredentialSources.Database, row.Id);

        var s = meta.Value;
        var config = new MetaAppKeys { AppId = s.AppId, AppSecret = s.AppSecret, VerifyToken = s.WebhookVerifyToken };
        return _meta = new(config, config.IsConfigured ? CredentialSources.Config : CredentialSources.None, null);
    }

    /// <summary>URL pública del webhook de Meta (null sin App:PublicBaseUrl).</summary>
    public string? MetaWebhookUrl => app.Value.HasPublicBaseUrl ? app.Value.PublicBaseUrl.TrimEnd('/') + MetaWebhookPath : null;

    public void Invalidate()
    {
        _meta = null;
        _teams = null;
        _google = null;
        _tiktok = null;
        _linkedin = null;
        _linkedinOrg = null;
    }

    private async Task<ResolvedKey<T>> LoadAsync<T>(
        string platform,
        T config,
        Func<T, string, string, T> withKeys,
        Func<T, bool> hasKeys,
        CancellationToken cancellationToken)
    {
        var row = await credentials.GetForPlatform(platform, cancellationToken);
        if (row is { PublicId: { Length: > 0 } publicId })
            return new(withKeys(config, publicId, protector.Unprotect(row.SecretCipher)), CredentialSources.Database, row.Id);

        return new(config, hasKeys(config) ? CredentialSources.Config : CredentialSources.None, null);
    }
}

public sealed record ResolvedKey<T>(T Settings, string Source, int? CredentialId);
