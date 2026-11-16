using System.Text.RegularExpressions;

namespace YoutubeMeta.Api.Domain.Rules;

/// <summary>
/// Plantillas propias: de publicación (título, texto, etiquetas de YouTube) y respuestas de la bandeja (/atajo).
/// Las etiquetas del texto ({titulo}, {nombre}, {?campo}, #bloque:x) las resuelve el front al usarlas: aquí solo se
/// valida lo que protege los datos.
/// </summary>
public static partial class TemplateRules
{
    public const int NameMax = 100;
    public const int ShortcutMax = 40;
    public const int BodyMax = 10000;
    /// <summary>El canal de la bandeja que más admite (WhatsApp y Telegram).</summary>
    public const int ReplyBodyMax = 4096;
    public const int TagsMax = 600;
    public const int MediaMax = 10;
    public const int AltMax = 1000;

    /// <summary>«/Envío » → «envío». Las respuestas se eligen escribiendo /atajo en la caja de texto.</summary>
    public static string? NormalizeShortcut(string? value)
    {
        string shortcut = (value ?? string.Empty).Trim().TrimStart('/').ToLowerInvariant();
        return shortcut.Length == 0 ? null : shortcut;
    }

    /// <summary>Redes donde se ofrece, sin repetir y en mayúsculas; vacío = en todas.</summary>
    public static IReadOnlyList<string> NormalizePlatforms(IEnumerable<string>? values) =>
        (values ?? []).Select(p => p.Trim().ToUpperInvariant()).Where(p => p.Length > 0).Distinct().ToList();

    /// <summary>null si la plantilla se puede guardar; si no, el motivo para el usuario.</summary>
    public static string? Validate(TemplateSaveRequest r)
    {
        if (!TemplateUsages.IsValid(r.Usage)) return "Indica si la plantilla es para publicar o para responder.";

        string name = r.Name?.Trim() ?? string.Empty;
        if (name.Length is 0 or > NameMax) return $"El nombre debe tener entre 1 y {NameMax} caracteres.";

        string title = r.Title?.Trim() ?? string.Empty;
        string body = r.Body ?? string.Empty;
        bool reply = r.Usage == TemplateUsages.Reply;

        if (reply)
        {
            string? shortcut = NormalizeShortcut(r.Shortcut);
            if (shortcut is null || !ShortcutFormat().IsMatch(shortcut))
                return $"El atajo va sin espacios: letras, números, - o _ (hasta {ShortcutMax}).";
            if (body.Trim().Length == 0 && r.Media.Count == 0) return "Escribe el texto de la respuesta o adjunta un archivo.";
            if (body.Length > ReplyBodyMax) return $"La respuesta admite como máximo {ReplyBodyMax} caracteres.";
            if (r.IsDefault) return "Solo una plantilla de publicación puede ser la predeterminada.";
        }
        else
        {
            if (title.Length == 0 && body.Trim().Length == 0 && r.Media.Count == 0) return "Escribe un título o un texto, o adjunta un archivo.";
            if (title.Length > PublicationRules.TitleMax) return $"El título admite como máximo {PublicationRules.TitleMax} caracteres.";
            if (body.Length > BodyMax) return $"El texto admite como máximo {BodyMax} caracteres.";
            if ((r.Tags?.Trim().Length ?? 0) > TagsMax) return $"Las etiquetas de YouTube admiten como máximo {TagsMax} caracteres.";
        }

        var platforms = NormalizePlatforms(r.Platforms);
        if (platforms.Any(p => reply ? !Platforms.IsConnectable(p) : !Platforms.IsValid(p))) return "Una de las redes elegidas no es válida.";

        if (r.Media.Count > MediaMax) return $"Como mucho {MediaMax} archivos por plantilla.";
        if (r.Media.Select(m => m.MediaId).Distinct().Count() != r.Media.Count) return "Un archivo está repetido.";
        if (r.Media.Any(m => (m.Alt?.Length ?? 0) > AltMax)) return $"El texto alternativo admite como máximo {AltMax} caracteres.";
        return null;
    }

    [GeneratedRegex(@"^[a-z0-9áéíóúñü_-]{1,40}$")]
    private static partial Regex ShortcutFormat();
}
