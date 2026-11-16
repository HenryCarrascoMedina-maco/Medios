using System.Text.RegularExpressions;

namespace YoutubeMeta.Api.Domain.Rules;

/// <summary>Normalización de etiquetas de la biblioteca y nombres de bloques de hashtags (las plantillas: <see cref="TemplateRules"/>).</summary>
public static partial class ContentRules
{
    public const int TagMax = 50;
    public const int BlockNameMax = 50;
    public const int BlockContentMax = 1000;
    public const int SignatureMax = 1000;

    /// <summary>«#Mi Etiqueta» → «mi-etiqueta». null si no queda nada válido.</summary>
    public static string? NormalizeTag(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        string tag = value.Trim().TrimStart('#').ToLowerInvariant();
        tag = Whitespace().Replace(tag, "-");
        tag = NotAllowed().Replace(tag, string.Empty).Trim('-');
        if (tag.Length > TagMax) tag = tag[..TagMax];
        return tag.Length == 0 ? null : tag;
    }

    public static IReadOnlyList<string> NormalizeTags(IEnumerable<string>? values) =>
        (values ?? []).Select(NormalizeTag).OfType<string>().Distinct().ToList();

    /// <summary>Nombre usable como #bloque:nombre.</summary>
    public static bool IsValidBlockName(string? value) => value is { Length: > 0 and <= BlockNameMax } && BlockName().IsMatch(value);

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"[^\p{L}\p{N}_-]")]
    private static partial Regex NotAllowed();

    [GeneratedRegex(@"^[a-z0-9_-]+$")]
    private static partial Regex BlockName();
}
