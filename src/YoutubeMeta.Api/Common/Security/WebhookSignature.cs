using System.Security.Cryptography;
using System.Text;

namespace YoutubeMeta.Api.Common.Security;

/// <summary>
/// Autenticidad de los webhooks de la bandeja (las rutas son anónimas: la plataforma no inicia sesión).
/// <list type="bullet">
/// <item>Meta firma el cuerpo con el App Secret: cabecera X-Hub-Signature-256 = «sha256=» + HMAC-SHA256 en hex.</item>
/// <item>Telegram repite en X-Telegram-Bot-Api-Secret-Token el secreto que se le dio en setWebhook. Se deriva de
/// Security:SecretKey y del id del bot, así no hay que guardarlo.</item>
/// </list>
/// </summary>
public sealed class WebhookSignature(IOptions<SecuritySettings> security)
{
    public const string MetaHeader = "X-Hub-Signature-256";
    public const string TelegramHeader = "X-Telegram-Bot-Api-Secret-Token";
    private const string MetaPrefix = "sha256=";

    public static bool VerifyMeta(ReadOnlySpan<byte> body, string? header, string appSecret)
    {
        if (string.IsNullOrEmpty(appSecret) || header is null || !header.StartsWith(MetaPrefix, StringComparison.OrdinalIgnoreCase)) return false;

        byte[] expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(appSecret), body);
        byte[] actual;
        try
        {
            actual = Convert.FromHexString(header[MetaPrefix.Length..]);
        }
        catch (FormatException)
        {
            return false;
        }
        return CryptographicOperations.FixedTimeEquals(expected, actual);
    }

    /// <summary>Secreto del webhook de un bot (Telegram admite A-Z, a-z, 0-9, _ y -; hasta 256 caracteres).</summary>
    public string TelegramSecret(int credentialId) =>
        Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(security.Value.SecretKey), Encoding.UTF8.GetBytes($"telegram-webhook\n{credentialId}")))
            .ToLowerInvariant();

    public bool VerifyTelegram(int credentialId, string? header) =>
        header is not null && FixedTimeText.Matches(TelegramSecret(credentialId), header);

    /// <summary>Texto aleatorio que Meta repite al verificar la URL del webhook.</summary>
    public static string NewVerifyToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
}
