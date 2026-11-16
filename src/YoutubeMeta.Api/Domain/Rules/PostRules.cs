namespace YoutubeMeta.Api.Domain.Rules;

/// <summary>
/// Qué admite cada plataforma por API. Única fuente: la usa la API para validar y el front (vía /Rules) para
/// mostrar en cada destino por qué no está disponible.
/// </summary>
/// <param name="Kinds">Tipos de post que se pueden publicar.</param>
/// <param name="MaxImages">Imágenes por carrusel (0 = no admite imágenes).</param>
/// <param name="ImageMaxBytes">Tamaño máximo de cada imagen.</param>
/// <param name="ImageTypes">Formatos de imagen aceptados (Content-Type).</param>
/// <param name="ImagesNeedPublicUrl">La plataforma descarga las imágenes desde una URL pública (no acepta el archivo).</param>
/// <param name="FirstComment">Puede poner un primer comentario justo después de publicar.</param>
/// <param name="TextMax">Máximo de caracteres del texto en posts sin archivo (null = lo valida PublicationRules).</param>
/// <param name="DocumentMaxBytes">Tamaño máximo de un PDF (null = no admite documentos o lo limita el bot).</param>
public sealed record PlatformCapability(
    string Platform,
    string[] Kinds,
    int MaxImages,
    long ImageMaxBytes,
    string[] ImageTypes,
    bool ImagesNeedPublicUrl,
    bool FirstComment,
    int? TextMax,
    long? DocumentMaxBytes);

public static class PlatformCapabilities
{
    private const long Mb = 1024L * 1024L;
    private static readonly string[] Jpeg = ["image/jpeg"];
    private static readonly string[] JpegPng = ["image/jpeg", "image/png"];

    public const int TelegramTextMax = 4096;
    public const int LinkedinTextMax = 3000;
    public const int FacebookTextMax = 63206;
    public const int TeamsTextMax = 20000;

    /// <summary>
    /// Canal de Teams por webhook (Workflows): solo una tarjeta con texto, enlace e imágenes por URL pública. Sin
    /// adjuntos ni respuestas en el hilo.
    /// </summary>
    public static readonly PlatformCapability TeamsWebhook = new(Platforms.Teams,
        [PostKinds.Text, PostKinds.Link, PostKinds.Image, PostKinds.Carousel], 10, 20 * Mb, JpegPng, true, false, TeamsTextMax, null);

    public static readonly IReadOnlyDictionary<string, PlatformCapability> ByPlatform = new Dictionary<string, PlatformCapability>
    {
        [Platforms.YouTube] = new(Platforms.YouTube, [PostKinds.Video], 0, 0, [], false, false, null, null),
        [Platforms.Facebook] = new(Platforms.Facebook,
            [PostKinds.Text, PostKinds.Link, PostKinds.Image, PostKinds.Carousel, PostKinds.Video], 10, 10 * Mb, JpegPng, false, true, FacebookTextMax, null),
        [Platforms.Instagram] = new(Platforms.Instagram,
            [PostKinds.Image, PostKinds.Carousel, PostKinds.Video], 10, 8 * Mb, Jpeg, true, true, null, null),
        [Platforms.Telegram] = new(Platforms.Telegram, PostKinds.All, 10, 10 * Mb, JpegPng, false, false, TelegramTextMax, null),
        [Platforms.TikTok] = new(Platforms.TikTok,
            [PostKinds.Image, PostKinds.Carousel, PostKinds.Video], 35, 20 * Mb, Jpeg, true, false, null, null),
        [Platforms.LinkedIn] = new(Platforms.LinkedIn, PostKinds.All, 20, 20 * Mb, JpegPng, false, true, LinkedinTextMax, 100 * Mb),
        // Graph: imágenes dentro del mensaje (o como archivo si pesan mucho), video y PDF a «Archivos» del canal.
        [Platforms.Teams] = new(Platforms.Teams, PostKinds.All, 10, 20 * Mb, JpegPng, false, true, TeamsTextMax, 250 * Mb)
    };

    /// <summary>Lo que admite una cuenta concreta (un canal de Teams por webhook admite menos que uno por Graph).</summary>
    public static PlatformCapability ForAccount(string platform, string externalId) =>
        Platforms.IsTeamsWebhook(platform, externalId) ? TeamsWebhook : For(platform);

    public static PlatformCapability For(string platform) =>
        ByPlatform.TryGetValue(platform, out var capability) ? capability : throw new ArgumentOutOfRangeException(nameof(platform), platform, null);

    /// <summary>
    /// Primer motivo por el que este post no se puede publicar en la plataforma, o null. <paramref name="publicMediaAvailable"/>
    /// = la API tiene una dirección pública (App:PublicBaseUrl) desde la que Instagram y TikTok pueden descargar.
    /// </summary>
    public static string? Validate(string platform, string kind, IReadOnlyList<MediaInfo> media, bool publicMediaAvailable) =>
        Validate(For(platform), kind, media, publicMediaAvailable);

    public static string? Validate(PlatformCapability c, string kind, IReadOnlyList<MediaInfo> media, bool publicMediaAvailable)
    {
        string platform = c.Platform;
        string label = Platforms.Label(platform);

        if (!c.Kinds.Contains(kind))
            return c == TeamsWebhook
                ? "Un canal conectado por webhook solo admite texto, enlace e imágenes. Para video o PDF conéctalo con Microsoft Graph."
                : $"{label} no admite publicaciones de tipo {PostKinds.Label(kind)} por API.";

        if (kind is PostKinds.Image or PostKinds.Carousel)
        {
            if (media.Count > c.MaxImages) return $"{label} admite como máximo {c.MaxImages} imágenes por publicación.";
            if (platform == Platforms.Telegram && kind == PostKinds.Carousel && media.Count < 2) return "Un álbum de Telegram necesita al menos 2 imágenes.";
            foreach (var m in media)
            {
                if (!c.ImageTypes.Contains(m.ContentType, StringComparer.OrdinalIgnoreCase))
                    return $"{label} solo acepta imágenes {string.Join(" o ", c.ImageTypes.Select(t => t.Replace("image/", "").ToUpperInvariant()))}. «{m.Title}» no lo es.";
                if (m.SizeBytes > c.ImageMaxBytes)
                    return $"{label} admite imágenes de hasta {c.ImageMaxBytes / Mb} MB. «{m.Title}» pesa más.";
            }
            if (c.ImagesNeedPublicUrl && !publicMediaAvailable)
                return $"{label} descarga las imágenes desde una dirección pública y este servidor no tiene una configurada (App:PublicBaseUrl). " +
                       "Funciona cuando la app está publicada en un dominio; ver la guía de despliegue.";
        }

        if (kind == PostKinds.Document && c.DocumentMaxBytes is { } maxDoc && media.Count == 1 && media[0].SizeBytes > maxDoc)
            return $"{label} admite documentos de hasta {maxDoc / Mb} MB.";

        return null;
    }
}

/// <summary>Lo que las reglas necesitan saber de cada archivo elegido.</summary>
public sealed record MediaInfo(int Id, string Title, string MediaKind, string ContentType, long SizeBytes, decimal? DurationSec);

/// <summary>Tipo de un post a partir de sus archivos y su enlace.</summary>
public static class PostRules
{
    public const int MaxMedia = 35;
    public const int LinkMax = 1000;

    /// <summary>(tipo, null) o (null, motivo para el usuario).</summary>
    public static (string? Kind, string? Error) InferKind(IReadOnlyList<MediaInfo> media, string? linkUrl)
    {
        bool hasLink = !string.IsNullOrWhiteSpace(linkUrl);
        if (hasLink && !IsHttpUrl(linkUrl)) return (null, "El enlace debe empezar por http:// o https://.");
        if (hasLink && linkUrl!.Length > LinkMax) return (null, $"El enlace admite como máximo {LinkMax} caracteres.");

        if (media.Count == 0) return (hasLink ? PostKinds.Link : PostKinds.Text, null);
        if (hasLink) return (null, "Un enlace con vista previa va sin archivos. Si quieres ambos, pega el enlace en el texto.");
        if (media.Count > MaxMedia) return (null, $"Como mucho {MaxMedia} archivos por publicación.");

        var kinds = media.Select(m => m.MediaKind).Distinct().ToList();
        if (kinds.Count > 1) return (null, "Una publicación lleva solo imágenes, o un video, o un PDF; no se pueden mezclar.");

        return kinds[0] switch
        {
            MediaKinds.Video when media.Count == 1 => (PostKinds.Video, null),
            MediaKinds.Video => (null, "Solo se puede publicar un video por publicación."),
            MediaKinds.Document when media.Count == 1 => (PostKinds.Document, null),
            MediaKinds.Document => (null, "Solo se puede publicar un PDF por publicación."),
            MediaKinds.Image => (media.Count == 1 ? PostKinds.Image : PostKinds.Carousel, null),
            _ => (null, "Tipo de archivo no válido.")
        };
    }

    public const int DerivedTitleMax = 80;

    /// <summary>Título para un post que no lo pide (texto, enlace, imágenes): la primera línea del texto, recortada.</summary>
    public static string TitleFromText(string? text, string kind)
    {
        string line = (text ?? string.Empty).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault() ?? string.Empty;
        if (line.Length == 0) return char.ToUpperInvariant(PostKinds.Label(kind)[0]) + PostKinds.Label(kind)[1..];
        return line.Length <= DerivedTitleMax ? line : line[..(DerivedTitleMax - 1)].TrimEnd() + "…";
    }

    public static bool IsHttpUrl(string? value) =>
        Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp);
}
