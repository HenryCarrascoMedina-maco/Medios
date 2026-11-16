using YoutubeMeta.Api.Infrastructure.External;

namespace YoutubeMeta.Api.Application.Inbox;

/// <summary>
/// Los canales de la bandeja de las plataformas activas (Platforms:Disabled) y lo que depende del servidor: dirección
/// pública y app de Meta. Un solo sitio para que la API y el job vean lo mismo.
/// </summary>
public sealed class InboxChannels(
        IEnumerable<IInboxChannel> channels,
        PlatformKeys keys,
        IOptions<AppSettings> app,
        IOptions<InboxSettings> settings,
        IOptions<PlatformsSettings> platforms)
{
    private readonly Dictionary<string, IInboxChannel> _channels = channels
        .Where(c => platforms.Value.IsEnabled(c.Platform))
        .ToDictionary(c => c.Platform);

    public InboxSettings Settings => settings.Value;

    public IInboxChannel? For(string platform) => _channels.GetValueOrDefault(platform);

    public bool IsEnabled(string platform) => _channels.ContainsKey(platform);

    public async Task<InboxEnvironment> EnvironmentAsync(CancellationToken cancellationToken)
    {
        var meta = await keys.MetaAppAsync(cancellationToken);
        return new InboxEnvironment(app.Value.HasPublicBaseUrl ? app.Value.PublicBaseUrl.TrimEnd('/') : null, meta.Settings.IsConfigured, settings.Value);
    }

    /// <summary>Qué puede recibir la cuenta y qué le falta. Una plataforma sin bandeja (TikTok) o desactivada no recibe.</summary>
    public InboxAccountStatus Inspect(InboxAccountRow account, InboxEnvironment environment)
    {
        if (For(account.Platform) is not { } channel)
            return new(false, false, InboxModes.None, $"{Platforms.Label(account.Platform)} no permite leer mensajes ni comentarios desde aplicaciones como esta.");
        if (account.StatusCode != ConnectionStatus.Connected)
            return channel.Inspect(account, environment) with { Problem = "La cuenta necesita reconectarse en Conexiones.", Fix = InboxFixes.Reconnect };
        return channel.Inspect(account, environment);
    }
}
