using YoutubeMeta.Api.Application.Publishing;

namespace YoutubeMeta.Api.Infrastructure.External.Meta;

/// <summary>Meta reparte los códigos entre code y error_subcode: se miran ambos.</summary>
public static class MetaErrorClassifier
{
    private static readonly HashSet<int> RateLimit = [4, 17, 32, 613, 80001];
    private static readonly HashSet<int> Permissions = [10, 200, 1363042];
    private static readonly HashSet<int> Transient = [1, 2, 6001, 1363030, 1363019, 1363021, 1363033, 1363011];

    public const int InvalidOffset = 1363037;
    public const int SessionExpired = 1363041;

    /// <summary>Mensaje para la persona al conectar o probar una cuenta de Meta.</summary>
    public static string Friendly(MetaError error) => error.Code switch
    {
        190 => "El token no es válido o caducó. Genera uno nuevo en Meta Business (usuario del sistema).",
        10 or 200 => "Al token le faltan permisos. Genéralo de nuevo marcando los permisos de la guía.",
        _ => $"Meta respondió: {error.Message}"
    };

    public static PublishStep Classify(MetaError error)
    {
        int code = error.Code;
        int sub = error.Subcode ?? 0;
        string tag = sub > 0 ? $"{code}/{sub}" : code.ToString();
        bool Has(int value) => code == value || sub == value;
        bool Any(HashSet<int> set) => set.Contains(code) || set.Contains(sub);

        if (Has(190))
            return PublishStep.NeedsReconnect(tag, "El token de la Página ya no es válido. Vuelve a conectar la Página en Conexiones.");

        if (Any(Permissions))
            return PublishStep.NeedsReconnect(tag, "Al token le faltan permisos (pages_manage_posts). Genera uno nuevo y vuelve a conectar la Página.");

        if (Any(RateLimit))
        {
            int minutes = Math.Clamp(error.RegainAccessMinutes ?? 60, 5, 24 * 60);
            return PublishStep.WaitQuota(tag, $"Meta limitó las llamadas de la app. Se reintenta en {minutes} min.", TimeClock.UtcNow.AddMinutes(minutes));
        }

        if (Has(SessionExpired))
            return PublishStep.Restart(tag, "La sesión de subida de Facebook caducó; se sube de nuevo desde el inicio.");

        string? message = sub switch
        {
            1363023 or 1363026 => "El video supera el límite de Facebook (2 GB o 40 minutos).",
            1363022 or 1363025 => "El video es demasiado pequeño o corto para Facebook.",
            1363024 or 1363031 or 1363032 => "Facebook no reconoce el formato del video.",
            1607002 => "La fecha de programación es demasiado cercana o no válida.",
            _ => null
        };
        if (message != null) return PublishStep.Failed(tag, message);

        if (Has(368)) return PublishStep.Failed(tag, "Meta bloqueó la acción por considerarla no permitida. Revisa el estado de la Página.");
        if (Has(6000)) return PublishStep.Failed(tag, $"Facebook no pudo procesar el archivo: {error.Message}");

        if (error.IsTransient || Any(Transient) || code >= 500)
            return PublishStep.Retry(tag, $"Error temporal de Facebook: {error.Message}");

        return PublishStep.Failed(tag, $"Facebook rechazó la publicación: {error.Message}");
    }
}
