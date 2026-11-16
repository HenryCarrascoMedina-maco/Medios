using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.External;
using YoutubeMeta.Api.Infrastructure.External.Telegram;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;

#region RESPONSES
using SettingsResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Responses.PlatformSettingsResponse>;
using SaveResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<int>;
#endregion

namespace YoutubeMeta.Api.Application.Services;

/// <summary>
/// Ajustes › Plataformas: apps OAuth de cada plataforma, app de Meta y bots de Telegram, guardados cifrados en BD.
/// Los secretos nunca se devuelven. Lo guardado aquí tiene prioridad sobre user-secrets / IIS.
/// </summary>
public sealed class CredentialService(
        CredentialRepository credentials,
        PlatformKeys keys,
        TelegramBotClient telegram,
        SecretProtector protector,
        IProgressNotifier notifier,
        ExceptionHelper exception)
{
    private const string GoogleClientSuffix = ".apps.googleusercontent.com";

    public Task<SettingsResponse> Get(CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<SettingsResponse>(async () =>
        {
            var list = await credentials.List(cancellationToken);
            var google = await keys.GoogleAsync(cancellationToken);
            var tiktok = await keys.TiktokAsync(cancellationToken);
            var linkedin = await keys.LinkedinAsync(false, cancellationToken);
            var linkedinOrg = await keys.LinkedinAsync(true, cancellationToken);
            var teams = await keys.TeamsAsync(cancellationToken);
            var teamsSource = Source(teams.Source, teams.CredentialId, teams.Settings.ClientId, teams.Settings.RedirectUri, list);
            var meta = await keys.MetaAppAsync(cancellationToken);
            var metaSource = Source(meta.Source, meta.CredentialId, meta.Settings.AppId, string.Empty, list);
            metaSource.WebhookUrl = keys.MetaWebhookUrl;
            metaSource.VerifyToken = meta.Settings.VerifyToken.Length > 0 ? meta.Settings.VerifyToken : null;
            teamsSource.TenantId = teams.Settings.TenantId.Length > 0 ? teams.Settings.TenantId : null;
            teamsSource.SecretExpiresAt = teams.Settings.SecretExpiresAt;

            return SettingsResponse.Ok(new PlatformSettingsResponse
            {
                Google = Source(google.Source, google.CredentialId, google.Settings.ClientId, google.Settings.RedirectUri, list),
                Tiktok = Source(tiktok.Source, tiktok.CredentialId, tiktok.Settings.ClientKey, tiktok.Settings.RedirectUri, list),
                Linkedin = Source(linkedin.Source, linkedin.CredentialId, linkedin.Settings.ClientId, linkedin.Settings.RedirectUri, list),
                LinkedinOrg = Source(linkedinOrg.Source, linkedinOrg.CredentialId, linkedinOrg.Settings.ClientId, linkedinOrg.Settings.RedirectUri, list),
                Teams = teamsSource,
                MetaApp = metaSource,
                TelegramBots = list.Where(c => c.Platform == Platforms.Telegram).ToList()
            });
        });

    public Task<SaveResponse> Save(CredentialSaveRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<SaveResponse>(async () =>
        {
            string? secret = string.IsNullOrWhiteSpace(request.Secret) ? null : request.Secret.Trim();
            string? publicId = string.IsNullOrWhiteSpace(request.PublicId) ? null : request.PublicId.Trim();

            var (id, error) = request.Platform switch
            {
                Platforms.YouTube => await SaveOAuthClientAsync(request.Platform, "Cliente OAuth de Google", publicId, secret, userName,
                    publicId?.EndsWith(GoogleClientSuffix, StringComparison.Ordinal) == true ? null : $"El ID de cliente de Google termina en {GoogleClientSuffix}.", cancellationToken),
                Platforms.TikTok => await SaveOAuthClientAsync(request.Platform, "App de TikTok", publicId, secret, userName,
                    publicId is { Length: >= 10 } ? null : "Pega el Client key de tu app de TikTok.", cancellationToken),
                Platforms.LinkedIn => await SaveOAuthClientAsync(request.Platform, "App de LinkedIn (perfiles)", publicId, secret, userName,
                    publicId is { Length: >= 8 } ? null : "Pega el Client ID de tu app de LinkedIn.", cancellationToken),
                Platforms.LinkedInOrgCredential => await SaveOAuthClientAsync(request.Platform, "App de LinkedIn (páginas de empresa)", publicId, secret, userName,
                    publicId is { Length: >= 8 } ? null : "Pega el Client ID de tu app de LinkedIn para páginas de empresa.", cancellationToken),
                Platforms.Teams => await SaveOAuthClientAsync(request.Platform, "App de Microsoft Entra (Teams)", publicId, secret, userName,
                    !Guid.TryParse(publicId, out _) ? "El Id. de aplicación (cliente) de Entra es un GUID: 8-4-4-4-12 caracteres."
                    : !Guid.TryParse(request.TenantId?.Trim(), out _) ? "Pega también el Id. de directorio (inquilino), que también es un GUID." : null,
                    cancellationToken, new CredentialSettings { TenantId = request.TenantId!.Trim(), SecretExpiresAt = request.SecretExpiresAt?.Date }.ToJson()),
                Platforms.MetaAppCredential => await SaveMetaAppAsync(publicId, secret, userName, cancellationToken),
                Platforms.Telegram => await SaveBotAsync(request, secret, userName, cancellationToken),
                _ => (0, "Plataforma no válida.")
            };
            if (error != null) return SaveResponse.Fail(error);

            await NotifyAsync(request.Platform, cancellationToken);
            return SaveResponse.Ok(id);
        });

    public Task<CustomTransactionResponse<string>> Delete(int id, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<string>>(async () =>
        {
            string? platform = await credentials.Delete(id, userName, cancellationToken);
            if (platform == null) return CustomTransactionResponse<string>.Fail("La clave no existe.");
            await NotifyAsync(platform, cancellationToken);
            return CustomTransactionResponse<string>.Ok(platform);
        });

    /// <summary>Google, TikTok y cada app de LinkedIn: un único cliente. Cambiarlo obliga a reconectar las cuentas que se conectaron con el anterior.</summary>
    private async Task<(int Id, string? Error)> SaveOAuthClientAsync(string platform, string name, string? publicId, string? secret, string userName, string? formatError,
        CancellationToken cancellationToken, string? settings = null)
    {
        if (formatError != null) return (0, formatError);

        var existing = await credentials.GetForPlatform(platform, cancellationToken);
        if (secret == null && existing == null) return (0, "Pega también el secreto del cliente.");

        int id = await credentials.Save(existing?.Id, platform, name, publicId, secret == null ? null : protector.Protect(secret), settings, userName, cancellationToken);
        return (id, null);
    }

    /// <summary>
    /// App de Meta (bandeja): App ID y App Secret. El texto de verificación del webhook se genera la primera vez y se
    /// conserva al cambiar el secreto, para no tener que pegarlo otra vez en Meta.
    /// </summary>
    private async Task<(int Id, string? Error)> SaveMetaAppAsync(string? publicId, string? secret, string userName, CancellationToken cancellationToken)
    {
        var existing = await credentials.GetForPlatform(Platforms.MetaAppCredential, cancellationToken);
        string verifyToken = CredentialSettings.Parse(existing?.Settings).VerifyToken ?? WebhookSignature.NewVerifyToken();
        return await SaveOAuthClientAsync(Platforms.MetaAppCredential, "App de Meta (bandeja)", publicId, secret, userName,
            publicId is { Length: >= 10 } && publicId.All(char.IsDigit) ? null : "El App ID de Meta son solo números (Panel de la app › Configuración › Básica).",
            cancellationToken, new CredentialSettings { VerifyToken = verifyToken }.ToJson());
    }

    /// <summary>Telegram: se valida el token con getMe y de ahí salen el nombre (@bot) y el id.</summary>
    private async Task<(int Id, string? Error)> SaveBotAsync(CredentialSaveRequest request, string? secret, string userName, CancellationToken cancellationToken)
    {
        string? apiBaseUrl = string.IsNullOrWhiteSpace(request.ApiBaseUrl) ? null : request.ApiBaseUrl.Trim().TrimEnd('/');
        if (apiBaseUrl != null && !Uri.TryCreate(apiBaseUrl, UriKind.Absolute, out _)) return (0, "La dirección del servidor Bot API no es válida (ejemplo: http://localhost:8081).");

        CredentialRow? existing = request.Id is { } id ? await credentials.Get(id, cancellationToken) : null;
        string? token = secret ?? (existing != null ? protector.Unprotect(existing.SecretCipher) : null);
        if (token == null) return (0, "Pega el token que te dio @BotFather.");

        var settings = new CredentialSettings
        {
            ApiBaseUrl = apiBaseUrl,
            MaxUploadMb = Math.Clamp(request.MaxUploadMb ?? (apiBaseUrl == null ? TelegramSettings.CloudMaxUploadMb : TelegramSettings.LocalMaxUploadMb), 1, TelegramSettings.LocalMaxUploadMb)
        };
        if (apiBaseUrl == null && settings.MaxUploadMb > TelegramSettings.CloudMaxUploadMb)
            return (0, $"Con el servidor público de Telegram el máximo es {TelegramSettings.CloudMaxUploadMb} MB. Para más, indica tu servidor Bot API.");

        var me = await telegram.GetMeAsync(settings.TelegramBaseUrl, token, cancellationToken);
        if (!me.Ok) return (0, TelegramPublisher.Friendly(me.Error!));

        int saved = await credentials.Save(existing?.Id, Platforms.Telegram, $"@{me.Data!.Username}", me.Data.Id.ToString(),
            secret == null ? null : protector.Protect(secret), settings.ToJson(), userName, cancellationToken);
        return (saved, null);
    }

    private static CredentialSource Source(string source, int? credentialId, string publicId, string redirectUri, IReadOnlyList<CredentialItem> list) => new()
    {
        Source = source,
        CredentialId = credentialId,
        PublicId = string.IsNullOrEmpty(publicId) ? null : publicId,
        RedirectUri = string.IsNullOrWhiteSpace(redirectUri) ? null : redirectUri,
        UpdatedAt = list.FirstOrDefault(c => c.Id == credentialId) is { } row ? row.UpdatedAt ?? row.CreatedAt : null
    };

    private async Task NotifyAsync(string platform, CancellationToken cancellationToken)
    {
        keys.Invalidate();
        await notifier.NotifyAsync(RealTimeEntities.Credential, new { platform, isFinal = true }, cancellationToken);
        await notifier.ConnectionChangedAsync(platform, cancellationToken);
    }
}
