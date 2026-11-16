using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace YoutubeMeta.Api.Common.Security;

/// <summary>
/// "state" firmado del OAuth de las plataformas. El callback es anónimo: lo único que prueba quién inició la
/// conexión y a dónde volver es esta firma HMAC, que además caduca a los 10 minutos.
/// </summary>
public static class OAuthState
{
    public const int LifetimeSeconds = 600;
    private const int ReturnUrlMaxLength = 512;
    private const int StateMaxLength = 2048;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private sealed class Payload
    {
        public int U { get; set; }
        public string R { get; set; } = "/";
        public long E { get; set; }
        public string N { get; set; } = string.Empty;
    }

    public static string Create(string purpose, int userId, string returnUrl, long expiresUnix, string secret)
    {
        string payload = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new Payload
        {
            U = userId,
            R = returnUrl,
            E = expiresUnix,
            N = Base64Url(RandomNumberGenerator.GetBytes(16))
        }, JsonOptions));
        return $"{payload}.{Sign(purpose, payload, secret)}";
    }

    public static bool TryRead(string purpose, string? state, string secret, long nowUnix, out int userId, out string returnUrl, out string? error)
    {
        userId = 0;
        returnUrl = "/";
        error = "invalid_state";

        if (string.IsNullOrWhiteSpace(state) || state.Length > StateMaxLength || secret.Length == 0) return false;

        int dot = state.IndexOf('.');
        if (dot <= 0 || dot != state.LastIndexOf('.')) return false;

        string payload = state[..dot];
        if (!FixedTimeText.Matches(Sign(purpose, payload, secret), state[(dot + 1)..])) return false;

        byte[]? json = FromBase64Url(payload);
        if (json == null) return false;

        Payload? data;
        try
        {
            data = JsonSerializer.Deserialize<Payload>(json, JsonOptions);
        }
        catch (JsonException)
        {
            return false;
        }

        string? safeUrl = SafeReturnUrl(data?.R);
        if (data == null || data.U <= 0 || safeUrl == null) return false;

        if (data.E < nowUnix)
        {
            error = "expired";
            return false;
        }

        userId = data.U;
        returnUrl = safeUrl;
        error = null;
        return true;
    }

    /// <summary>Solo rutas relativas de la propia app: evita usar el callback como redirección abierta.</summary>
    public static string? SafeReturnUrl(string? value)
    {
        string url = string.IsNullOrWhiteSpace(value) ? "/" : value.Trim();
        if (url.Length > ReturnUrlMaxLength) return null;
        if (url[0] != '/' || url.StartsWith("//", StringComparison.Ordinal)) return null;
        if (url.Contains('\\') || url.Any(char.IsControl) || url.Contains(' ')) return null;
        return Uri.TryCreate(url, UriKind.Relative, out _) ? url : null;
    }

    /// <summary>Vuelta al front tras el OAuth: ?{parameter}=connected|reconnected|error&amp;reason=…</summary>
    public static string BackUrl(string frontBaseUrl, string returnUrl, string parameter, string? reason, string result = "connected")
    {
        string separator = returnUrl.Contains('?') ? "&" : "?";
        string value = reason == null ? result : $"error&reason={Uri.EscapeDataString(reason)}";
        return $"{frontBaseUrl.TrimEnd('/')}{returnUrl}{separator}{parameter}={value}";
    }

    private static string Sign(string purpose, string payload, string secret) =>
        Base64Url(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes($"{purpose}\n{payload}")));

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[]? FromBase64Url(string value)
    {
        string base64 = value.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '=');
        try
        {
            return Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
