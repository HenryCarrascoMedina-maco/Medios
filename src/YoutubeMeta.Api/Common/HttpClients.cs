namespace YoutubeMeta.Api.Common;

/// <summary>
/// HttpClient nombrados; todos se registran sin loggers para no escribir URLs ni tokens (la Bot API de
/// Telegram lleva el token en la propia URL). Los de subida no tienen timeout global: los corta el latido.
/// </summary>
public static class HttpClients
{
    public const string Google = "Google";
    public const string Meta = "Meta";
    public const string MetaUpload = "MetaUpload";
    public const string Telegram = "Telegram";
    public const string TelegramUpload = "TelegramUpload";
    public const string Tiktok = "Tiktok";
    public const string TiktokUpload = "TiktokUpload";
    public const string Linkedin = "Linkedin";
    public const string LinkedinUpload = "LinkedinUpload";
    public const string Teams = "Teams";
    public const string TeamsUpload = "TeamsUpload";
}
