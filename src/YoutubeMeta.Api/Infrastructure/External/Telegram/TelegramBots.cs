using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Infrastructure.External.Telegram;

/// <summary>Bot guardado en Ajustes, con su token ya descifrado y su servidor Bot API.</summary>
public sealed record TelegramBot(int CredentialId, string Token, CredentialSettings Options)
{
    public string BaseUrl => Options.TelegramBaseUrl;
}

/// <summary>Bots de Telegram: lo usan publicar, conectar canales y la bandeja (un solo sitio que descifra el token).</summary>
public sealed class TelegramBots(CredentialRepository credentials, SecretProtector protector)
{
    public async Task<TelegramBot?> GetAsync(int? credentialId, CancellationToken cancellationToken)
    {
        if (credentialId is not { } id) return null;
        var row = await credentials.Get(id, cancellationToken);
        if (row is null || row.Platform != Platforms.Telegram || protector.UnprotectOrNull(row.SecretCipher) is not { } token) return null;
        return new TelegramBot(id, token, CredentialSettings.Parse(row.Settings));
    }
}
