using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.External;
using YoutubeMeta.Api.Infrastructure.External.Telegram;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Application.Inbox;

/// <summary>
/// Entrada de los webhooks: verifica que el aviso es auténtico, lo guarda en crudo (idempotente) y responde enseguida.
/// El job lo procesa después: si algo falla al procesar, la plataforma no reintenta en bucle y el aviso no se pierde.
/// </summary>
public sealed class InboxWebhookService(InboxRepository inbox, InboxChannels channels, PlatformKeys keys, WebhookSignature signature, ILogger<InboxWebhookService> logger)
{
    /// <summary>Verificación de la URL en la app de Meta: devuelve hub.challenge si el texto de verificación coincide.</summary>
    public async Task<string?> MetaVerify(string? mode, string? verifyToken, string? challenge, CancellationToken cancellationToken)
    {
        var meta = (await keys.MetaAppAsync(cancellationToken)).Settings;
        if (mode != "subscribe" || meta.VerifyToken.Length == 0 || verifyToken is null) return null;
        bool ok = CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(meta.VerifyToken), Encoding.UTF8.GetBytes(verifyToken));
        return ok ? challenge : null;
    }

    /// <summary>
    /// Aviso de Meta (Facebook, Instagram o WhatsApp). false = firma no válida (no se guarda nada). Cada entrada se guarda
    /// por separado con el hash de su contenido como clave: un reintento de Meta no duplica nada.
    /// </summary>
    public async Task<bool> MetaReceive(byte[] body, string? signatureHeader, CancellationToken cancellationToken)
    {
        var meta = (await keys.MetaAppAsync(cancellationToken)).Settings;
        if (!WebhookSignature.VerifyMeta(body, signatureHeader, meta.AppSecret))
        {
            logger.LogWarning("Webhook de Meta con firma no válida: se ignora.");
            return false;
        }

        using var document = JsonDocument.Parse(body);
        string? platform = document.RootElement.TryGetProperty("object", out var kind) ? MetaPlatform(kind.GetString()) : null;
        if (platform is null || !channels.IsEnabled(platform) || !document.RootElement.TryGetProperty("entry", out var entries)) return true;

        foreach (var entry in entries.EnumerateArray())
        {
            string raw = entry.GetRawText();
            await inbox.EventSave(platform, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant(), raw, cancellationToken);
        }
        return true;
    }

    /// <summary>Novedad de un bot de Telegram. false = secreto no válido.</summary>
    public async Task<bool> TelegramReceive(int credentialId, string? secret, byte[] body, CancellationToken cancellationToken)
    {
        if (!signature.VerifyTelegram(credentialId, secret))
        {
            logger.LogWarning("Webhook de Telegram con secreto no válido (bot {Id}): se ignora.", credentialId);
            return false;
        }
        if (!channels.IsEnabled(Platforms.Telegram)) return true;

        using var document = JsonDocument.Parse(body);
        if (document.RootElement.TryGetProperty("update_id", out var updateId))
            await inbox.EventSave(Platforms.Telegram, $"{TelegramBotClient.EventKeyPrefix(credentialId)}{updateId.GetInt64()}", document.RootElement.GetRawText(), cancellationToken);
        return true;
    }

    public static string? MetaPlatform(string? metaObject) => metaObject switch
    {
        "page" => Platforms.Facebook,
        "instagram" => Platforms.Instagram,
        "whatsapp_business_account" => Platforms.WhatsApp,
        _ => null
    };
}
