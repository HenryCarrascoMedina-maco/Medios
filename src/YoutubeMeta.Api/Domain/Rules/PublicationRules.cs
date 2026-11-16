using System.Text;
using System.Text.RegularExpressions;

namespace YoutubeMeta.Api.Domain.Rules;

/// <summary>
/// Reglas de cada plataforma que valida la API aunque el front ya las valide: un cliente manipulado
/// no debe poder saltárselas. El front replica el mismo cálculo (publication-rules.ts).
/// </summary>
public static partial class PublicationRules
{
    public const int TitleMax = 255;

    public const int YoutubeTitleMax = 100;
    public const int YoutubeDescriptionMaxBytes = 5000;
    public const int YoutubeTagsMax = 500;

    public const int FacebookTitleMax = 255;
    public const int FacebookDescriptionMax = 5000;
    public static readonly TimeSpan FacebookScheduleMin = TimeSpan.FromMinutes(10);

    public const int InstagramCaptionMax = 2200;
    public const int InstagramHashtagsMax = 30;
    public const int InstagramMentionsMax = 20;
    public const long InstagramMaxBytes = 300L * 1024 * 1024;
    public const int InstagramMinSeconds = 3;
    public const int InstagramMaxSeconds = 15 * 60;

    public const int TelegramCaptionMax = 1024;

    public const int TiktokTitleMax = 2200;
    public const long TiktokMaxBytes = 4L * 1024 * 1024 * 1024;

    public const int LinkedinTitleMax = 400;
    public const long LinkedinVideoMaxBytes = 500L * 1024 * 1024;
    public const int LinkedinVideoMinSeconds = 3;
    public const int LinkedinVideoMaxSeconds = 30 * 60;

    /// <summary>Primer comentario: el mínimo de lo que admiten Instagram (2200), LinkedIn (1250) y Facebook.</summary>
    public const int FirstCommentMax = 1250;

    /// <summary>Las plataformas sin programación por API las retiene el job: como mucho 6 meses, igual que Facebook.</summary>
    public const int ScheduleMaxMonths = 6;

    public static int Utf8Bytes(string? value) => string.IsNullOrEmpty(value) ? 0 : Encoding.UTF8.GetByteCount(value);

    public static IReadOnlyList<string> SplitTags(string? tags) =>
        (tags ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    /// <summary>Como lo cuenta YouTube: las comas suman y una etiqueta con espacios lleva comillas (+2).</summary>
    public static int YoutubeTagsLength(string? tags)
    {
        var list = SplitTags(tags);
        if (list.Count == 0) return 0;
        return list.Sum(tag => tag.Length + (tag.Contains(' ') ? 2 : 0)) + list.Count - 1;
    }

    public static int HashtagCount(string? text) => string.IsNullOrEmpty(text) ? 0 : HashtagRegex().Count(text);

    public static int MentionCount(string? text) => string.IsNullOrEmpty(text) ? 0 : MentionRegex().Count(text);

    /// <summary>Texto que acompaña al video en Telegram: la descripción o, si está vacía, el título.</summary>
    public static string TelegramCaption(string title, string? description) =>
        string.IsNullOrWhiteSpace(description) ? title : description;

    private static bool HasAngleBrackets(string? value) => value != null && (value.Contains('<') || value.Contains('>'));

    /// <summary>Primer error de una cuenta de destino o null si es válida.</summary>
    /// <param name="kind">Tipo de post (PostKinds). Los posts sin archivo exigen texto.</param>
    /// <param name="capability">Lo que admite la cuenta concreta (null = lo de la plataforma).</param>
    public static string? Validate(string platform, PublicationDestination d, DateTimeOffset now, string kind = PostKinds.Video, PlatformCapability? capability = null)
    {
        if (string.IsNullOrWhiteSpace(d.Title)) return "El título es obligatorio.";
        if (d.Title.Length > TitleMax) return $"El título admite como máximo {TitleMax} caracteres.";

        if (d.Options?.FirstComment is { Length: > 0 } comment)
        {
            if (!(capability ?? PlatformCapabilities.For(platform)).FirstComment) return $"{Platforms.Label(platform)} no permite poner un primer comentario por API.";
            if (comment.Length > FirstCommentMax) return $"El primer comentario admite como máximo {FirstCommentMax} caracteres.";
        }

        if (!PostKinds.HasMedia(kind) && platform != Platforms.Telegram && string.IsNullOrWhiteSpace(d.Description))
            return "Escribe el texto de la publicación.";
        if (!PostKinds.HasMedia(kind) && PlatformCapabilities.For(platform).TextMax is { } textMax
            && (platform == Platforms.Telegram ? TelegramCaption(d.Title, d.Description) : d.Description ?? "").Length > textMax)
            return $"El texto admite como máximo {textMax} caracteres en {Platforms.Label(platform)}.";

        return platform switch
        {
            Platforms.YouTube => ValidateYoutube(d, now),
            Platforms.Facebook => ValidateFacebook(d, now),
            Platforms.Instagram => ValidateInstagram(d, now),
            Platforms.Telegram => ValidateTelegram(d, now, kind),
            Platforms.TikTok => ValidateTiktok(d, now),
            Platforms.LinkedIn => ValidateLinkedin(d, now),
            Platforms.Teams => d.PublishAt is { } at ? ValidateSchedule(Platforms.Teams, at, now) : null,
            _ => "Destino no válido."
        };
    }

    /// <summary>Límites del archivo que la plataforma rechazaría seguro. null = se puede intentar.</summary>
    public static string? ValidateMedia(string platform, long sizeBytes, decimal? durationSec, int? uploadLimitMb)
    {
        switch (platform)
        {
            case Platforms.Instagram:
                if (sizeBytes > InstagramMaxBytes) return "Instagram admite Reels de hasta 300 MB por API. Comprime el video o elige otro.";
                if (durationSec is { } d && (d < InstagramMinSeconds || d > InstagramMaxSeconds)) return "Un Reel debe durar entre 3 segundos y 15 minutos.";
                return null;

            case Platforms.Telegram:
                int limitMb = uploadLimitMb ?? TelegramSettings.CloudMaxUploadMb;
                return sizeBytes > limitMb * 1024L * 1024L
                    ? $"El bot admite videos de hasta {limitMb} MB. Para más (hasta 2 GB) configura un servidor Bot API propio en Ajustes."
                    : null;

            case Platforms.TikTok:
                return sizeBytes > TiktokMaxBytes ? "TikTok admite videos de hasta 4 GB." : null;

            case Platforms.LinkedIn:
                if (sizeBytes > LinkedinVideoMaxBytes) return "LinkedIn admite videos de hasta 500 MB. Comprime el video o elige otro.";
                if (durationSec is { } ld && (ld < LinkedinVideoMinSeconds || ld > LinkedinVideoMaxSeconds)) return "Un video de LinkedIn debe durar entre 3 segundos y 30 minutos.";
                return null;

            default:
                return null;
        }
    }

    private static string? ValidateYoutube(PublicationDestination r, DateTimeOffset now)
    {
        if (r.Title.Length > YoutubeTitleMax) return $"El título de YouTube admite como máximo {YoutubeTitleMax} caracteres.";
        if (HasAngleBrackets(r.Title) || HasAngleBrackets(r.Description)) return "YouTube no admite los caracteres < ni > en el título ni en la descripción.";
        if (Utf8Bytes(r.Description) > YoutubeDescriptionMaxBytes) return $"La descripción supera los {YoutubeDescriptionMaxBytes} bytes que admite YouTube.";
        if (YoutubeTagsLength(r.Tags) > YoutubeTagsMax) return $"Las etiquetas superan los {YoutubeTagsMax} caracteres que admite YouTube.";
        if (string.IsNullOrWhiteSpace(r.CategoryId)) return "Elige la categoría del video.";
        if (r.PrivacyStatus is null || !PrivacyStatus.Youtube.Contains(r.PrivacyStatus)) return "Elige la visibilidad del video.";
        if (r.MadeForKids is null) return "Indica si el video es para niños.";
        if (r.ContainsSyntheticMedia is null) return "Indica si el video contiene contenido realista generado o alterado con IA.";

        if (r.PublishAt is { } at)
        {
            if (ValidateSchedule(Platforms.YouTube, at, now) is { } error) return error;
            if (r.PrivacyStatus != PrivacyStatus.Private) return "Un video programado se sube como Privado.";
        }

        return null;
    }

    private static string? ValidateFacebook(PublicationDestination r, DateTimeOffset now)
    {
        if (r.Title.Length > FacebookTitleMax) return $"El título admite como máximo {FacebookTitleMax} caracteres.";
        if ((r.Description?.Length ?? 0) > FacebookDescriptionMax) return $"La descripción admite como máximo {FacebookDescriptionMax} caracteres.";

        return r.PublishAt is { } at ? ValidateSchedule(Platforms.Facebook, at, now) : null;
    }

    private static string? ValidateInstagram(PublicationDestination r, DateTimeOffset now)
    {
        if ((r.Description?.Length ?? 0) > InstagramCaptionMax) return $"El texto de Instagram admite como máximo {InstagramCaptionMax} caracteres.";
        if (HashtagCount(r.Description) > InstagramHashtagsMax) return $"Instagram admite como máximo {InstagramHashtagsMax} hashtags.";
        if (MentionCount(r.Description) > InstagramMentionsMax) return $"Instagram admite como máximo {InstagramMentionsMax} menciones (@).";
        return r.PublishAt is { } at ? ValidateSchedule(Platforms.Instagram, at, now) : null;
    }

    private static string? ValidateTelegram(PublicationDestination r, DateTimeOffset now, string kind)
    {
        // Con archivo el texto va como pie (1024); sin archivo es un mensaje (4096, validado arriba).
        if (PostKinds.HasMedia(kind) && TelegramCaption(r.Title, r.Description).Length > TelegramCaptionMax)
            return $"El texto de Telegram admite como máximo {TelegramCaptionMax} caracteres.";
        return r.PublishAt is { } at ? ValidateSchedule(Platforms.Telegram, at, now) : null;
    }

    /// <summary>Requisitos de TikTok para apps de terceros: privacidad elegida a mano y contenido de marca nunca privado.</summary>
    private static string? ValidateTiktok(PublicationDestination r, DateTimeOffset now)
    {
        if (r.Title.Length > TiktokTitleMax) return $"El texto de TikTok admite como máximo {TiktokTitleMax} caracteres.";

        var options = r.Options ?? new PublicationOptions();
        if (!options.IsTiktokInbox)
        {
            if (r.PrivacyStatus is null || !PrivacyStatus.Tiktok.Contains(r.PrivacyStatus)) return "Elige quién puede ver el video en TikTok.";
            if (options.BrandContent == true && r.PrivacyStatus == PrivacyStatus.Private) return "El contenido de marca no puede publicarse como privado en TikTok.";
        }

        return r.PublishAt is { } at ? ValidateSchedule(Platforms.TikTok, at, now) : null;
    }

    private static string? ValidateLinkedin(PublicationDestination r, DateTimeOffset now)
    {
        if (r.Title.Length > LinkedinTitleMax) return $"El título de LinkedIn admite como máximo {LinkedinTitleMax} caracteres.";
        if ((r.Description?.Length ?? 0) > PlatformCapabilities.LinkedinTextMax) return $"El texto de LinkedIn admite como máximo {PlatformCapabilities.LinkedinTextMax} caracteres.";
        if (r.PrivacyStatus is null || !PrivacyStatus.Linkedin.Contains(r.PrivacyStatus)) return "Elige quién puede ver la publicación en LinkedIn.";
        return r.PublishAt is { } at ? ValidateSchedule(Platforms.LinkedIn, at, now) : null;
    }

    /// <summary>
    /// Ventana de programación de cada plataforma (alta y reprogramación desde el calendario). YouTube solo exige
    /// que sea futura; Facebook, de 10 min a 6 meses; las que programa el job, hasta 6 meses.
    /// </summary>
    public static string? ValidateSchedule(string platform, DateTimeOffset at, DateTimeOffset now)
    {
        if (platform == Platforms.Facebook)
        {
            if (at < now + FacebookScheduleMin) return "La publicación programada debe ser al menos 10 minutos después de ahora.";
            if (at > now.AddMonths(ScheduleMaxMonths)) return "Facebook permite programar como máximo 6 meses por delante.";
            return null;
        }

        if (at <= now) return "La fecha de publicación debe ser futura.";
        if (platform != Platforms.YouTube && at > now.AddMonths(ScheduleMaxMonths)) return "Se puede programar como máximo 6 meses por delante.";
        return null;
    }

    /// <summary>Los límites que el front necesita para validar mientras se escribe (una sola fuente: esta clase).</summary>
    /// <param name="publicMediaAvailable">Hay App:PublicBaseUrl: Instagram y TikTok pueden descargar imágenes.</param>
    /// <param name="enabledPlatforms">Plataformas activas en esta instalación (Platforms:Disabled); null = todas.</param>
    public static PublicationRulesInfo Describe(bool publicMediaAvailable = false, IReadOnlyList<string>? enabledPlatforms = null) => new(
        TitleMax, YoutubeTitleMax, YoutubeDescriptionMaxBytes, YoutubeTagsMax,
        FacebookTitleMax, FacebookDescriptionMax, (int)FacebookScheduleMin.TotalMinutes,
        InstagramCaptionMax, InstagramHashtagsMax, InstagramMentionsMax, InstagramMaxBytes, InstagramMinSeconds, InstagramMaxSeconds,
        TelegramCaptionMax, TiktokTitleMax, TiktokMaxBytes, ScheduleMaxMonths)
    {
        LinkedinTitleMax = LinkedinTitleMax,
        LinkedinTextMax = PlatformCapabilities.LinkedinTextMax,
        LinkedinVideoMaxBytes = LinkedinVideoMaxBytes,
        TelegramTextMax = PlatformCapabilities.TelegramTextMax,
        FirstCommentMax = FirstCommentMax,
        MaxMedia = PostRules.MaxMedia,
        PublicMediaAvailable = publicMediaAvailable,
        Platforms = PlatformCapabilities.ByPlatform,
        TeamsWebhook = PlatformCapabilities.TeamsWebhook,
        EnabledPlatforms = enabledPlatforms ?? Domain.Constants.Platforms.Connectable
    };

    [GeneratedRegex(@"(^|\s)#[\p{L}\p{N}_]+")]
    private static partial Regex HashtagRegex();

    [GeneratedRegex(@"(^|\s)@[\p{L}\p{N}_.]+")]
    private static partial Regex MentionRegex();
}

public sealed record PublicationRulesInfo(
    int TitleMax,
    int YoutubeTitleMax,
    int YoutubeDescriptionMaxBytes,
    int YoutubeTagsMax,
    int FacebookTitleMax,
    int FacebookDescriptionMax,
    int FacebookScheduleMinMinutes,
    int InstagramCaptionMax,
    int InstagramHashtagsMax,
    int InstagramMentionsMax,
    long InstagramMaxBytes,
    int InstagramMinSeconds,
    int InstagramMaxSeconds,
    int TelegramCaptionMax,
    int TiktokTitleMax,
    long TiktokMaxBytes,
    int ScheduleMaxMonths)
{
    public int LinkedinTitleMax { get; init; }
    public int LinkedinTextMax { get; init; }
    public long LinkedinVideoMaxBytes { get; init; }
    public int TelegramTextMax { get; init; }
    public int FirstCommentMax { get; init; }
    public int MaxMedia { get; init; }
    /// <summary>false = Instagram y TikTok no pueden publicar imágenes desde este servidor (falta App:PublicBaseUrl).</summary>
    public bool PublicMediaAvailable { get; init; }
    /// <summary>Qué admite cada plataforma (tipos, imágenes, primer comentario).</summary>
    public IReadOnlyDictionary<string, PlatformCapability> Platforms { get; init; } = new Dictionary<string, PlatformCapability>();
    /// <summary>Lo que admite un canal de Teams conectado por webhook (externalId «webhook:…»).</summary>
    public PlatformCapability? TeamsWebhook { get; init; }
    /// <summary>Plataformas activas (se pueden conectar y, salvo WhatsApp, publicar). Las demás no se muestran.</summary>
    public IReadOnlyList<string> EnabledPlatforms { get; init; } = [];
}
