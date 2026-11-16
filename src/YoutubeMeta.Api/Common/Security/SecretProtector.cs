using System.Security.Cryptography;
using System.Text;

namespace YoutubeMeta.Api.Common.Security;

/// <summary>
/// Cifra tokens y URIs de sesión antes de guardarlos en BD. AES-GCM con un nonce aleatorio por valor: dos
/// cifrados del mismo texto no se parecen y cualquier alteración se detecta al descifrar.
/// Formato: base64(nonce[12] | tag[16] | cipher).
/// </summary>
public sealed class SecretProtector
{
    private const int NonceSize = 12;
    private const int TagSize = 16;

    private readonly byte[] _key;

    public SecretProtector(IOptions<SecuritySettings> settings)
    {
        _key = Convert.FromBase64String(settings.Value.SecretKey);
        if (_key.Length != 32) throw new InvalidOperationException("Security:SecretKey debe ser una clave de 32 bytes en base64.");
    }

    public string Protect(string plainText)
    {
        byte[] plain = Encoding.UTF8.GetBytes(plainText);
        byte[] buffer = new byte[NonceSize + TagSize + plain.Length];
        Span<byte> nonce = buffer.AsSpan(0, NonceSize);
        RandomNumberGenerator.Fill(nonce);

        using var aes = new AesGcm(_key, TagSize);
        aes.Encrypt(nonce, plain, buffer.AsSpan(NonceSize + TagSize), buffer.AsSpan(NonceSize, TagSize));
        return Convert.ToBase64String(buffer);
    }

    public string Unprotect(string cipherText)
    {
        byte[] buffer = Convert.FromBase64String(cipherText);
        if (buffer.Length < NonceSize + TagSize) throw new CryptographicException("Valor cifrado inválido.");

        byte[] plain = new byte[buffer.Length - NonceSize - TagSize];
        using var aes = new AesGcm(_key, TagSize);
        aes.Decrypt(buffer.AsSpan(0, NonceSize), buffer.AsSpan(NonceSize + TagSize), buffer.AsSpan(NonceSize, TagSize), plain);
        return Encoding.UTF8.GetString(plain);
    }

    /// <summary>
    /// null si no hay valor o si no se puede descifrar (se cambió Security:SecretKey o el dato está dañado): para
    /// quien lo usa equivale a «no hay token» y la cuenta pide reconexión en vez de romper el job.
    /// </summary>
    public string? UnprotectOrNull(string? cipherText)
    {
        if (string.IsNullOrWhiteSpace(cipherText)) return null;
        try
        {
            return Unprotect(cipherText);
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException)
        {
            return null;
        }
    }
}
