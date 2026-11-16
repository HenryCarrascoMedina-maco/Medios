using System.Security.Cryptography;
using System.Text;

namespace YoutubeMeta.Api.Common.Security;

/// <summary>
/// Enlaces públicos, firmados y temporales a un archivo de la biblioteca. Instagram y TikTok no aceptan imágenes
/// como archivo: las descargan desde una URL. El enlace solo sirve para ese archivo y caduca (1 h por defecto); sin
/// App:PublicBaseUrl (https) no se generan, porque la plataforma no podría llegar al servidor.
/// </summary>
public sealed class MediaLinks(IOptions<AppSettings> app, IOptions<SecuritySettings> security)
{
    public const string RoutePrefix = "api/Media/Public";
    public static readonly TimeSpan DefaultLifetime = TimeSpan.FromHours(1);
    /// <summary>Enlace que se entrega a una plataforma: de sobra para que lo descargue.</summary>
    public static readonly TimeSpan PlatformLifetime = TimeSpan.FromHours(2);
    private const string Purpose = "media-public";

    public bool IsAvailable => app.Value.HasPublicBaseUrl && security.Value.SecretKey.Length > 0;

    /// <summary>URL pública del archivo o null si este servidor no tiene dirección pública.</summary>
    public string? PublicUrl(int mediaId, string extension, TimeSpan? lifetime = null, DateTimeOffset? now = null)
    {
        if (!IsAvailable) return null;
        long expires = (now ?? DateTimeOffset.UtcNow).Add(lifetime ?? DefaultLifetime).ToUnixTimeSeconds();
        string payload = $"{mediaId}.{expires}";
        // La extensión al final ayuda a las plataformas que deducen el tipo por la URL; no forma parte de la firma.
        return $"{app.Value.PublicBaseUrl.TrimEnd('/')}/{RoutePrefix}/{payload}.{Sign(payload)}.{extension.TrimStart('.').ToLowerInvariant()}";
    }

    /// <summary>Id del archivo si el token es auténtico y no ha caducado.</summary>
    public int? Read(string token, DateTimeOffset? now = null)
    {
        string[] parts = token.Split('.');
        if (parts.Length is < 3 or > 4) return null;
        if (!int.TryParse(parts[0], out int mediaId) || !long.TryParse(parts[1], out long expires)) return null;

        if (!FixedTimeText.Matches(Sign($"{parts[0]}.{parts[1]}"), parts[2])) return null;

        return expires >= (now ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds() ? mediaId : null;
    }

    private string Sign(string payload) =>
        Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(security.Value.SecretKey), Encoding.UTF8.GetBytes($"{Purpose}\n{payload}")))
            .ToLowerInvariant()[..32];
}
