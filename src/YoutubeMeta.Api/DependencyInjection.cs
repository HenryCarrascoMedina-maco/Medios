using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.IdentityModel.Tokens;
using System.Threading.RateLimiting;
using YoutubeMeta.Api.Application.Inbox;
using YoutubeMeta.Api.Application.Jobs;
using YoutubeMeta.Api.Application.Metrics;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Application.Services;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.Data;
using YoutubeMeta.Api.Infrastructure.External;
using YoutubeMeta.Api.Infrastructure.External.Linkedin;
using YoutubeMeta.Api.Infrastructure.External.Meta;
using YoutubeMeta.Api.Infrastructure.External.Teams;
using YoutubeMeta.Api.Infrastructure.External.Telegram;
using YoutubeMeta.Api.Infrastructure.External.Tiktok;
using YoutubeMeta.Api.Infrastructure.External.WhatsApp;
using YoutubeMeta.Api.Infrastructure.External.YouTube;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;
using YoutubeMeta.Api.Infrastructure.Storage;

namespace YoutubeMeta.Api;

public static class RateLimits
{
    public const string Login = "login";
}

public static class DependencyInjection
{
    public const string HubPath = "/hubs/progress";
    public const long MaxRequestBodyBytes = 64 * 1024 * 1024;

    public static IServiceCollection AddYoutubeMeta(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSettings(configuration);
        services.AddSecurity(configuration);

        services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new UtcDateTimeConverter()));
        services.AddSignalR();
        services.AddMemoryCache();
        services.AddHttpContextAccessor();
        services.AddSingleton(TimeProvider.System);
        services.Configure<ForwardedHeadersOptions>(o => o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);
        services.AddHealthChecks()
            .AddCheck<DatabaseHealthCheck>("database")
            .AddCheck<PublishJobHealthCheck>("publish-job");
        services.Configure<IISServerOptions>(o => o.MaxRequestBodySize = MaxRequestBodyBytes);

        // Sin loggers: Telegram lleva el token en la URL. Los de subida los corta el latido, no un timeout global.
        services.AddHttpClient(HttpClients.Google).RemoveAllLoggers();
        services.AddHttpClient(HttpClients.Meta, c => c.Timeout = TimeSpan.FromMinutes(10)).RemoveAllLoggers();
        services.AddHttpClient(HttpClients.MetaUpload, c => c.Timeout = Timeout.InfiniteTimeSpan).RemoveAllLoggers();
        services.AddHttpClient(HttpClients.Telegram, c => c.Timeout = TimeSpan.FromMinutes(1)).RemoveAllLoggers();
        services.AddHttpClient(HttpClients.TelegramUpload, c => c.Timeout = Timeout.InfiniteTimeSpan).RemoveAllLoggers();
        services.AddHttpClient(HttpClients.Tiktok, c => c.Timeout = TimeSpan.FromMinutes(1)).RemoveAllLoggers();
        services.AddHttpClient(HttpClients.TiktokUpload, c => c.Timeout = Timeout.InfiniteTimeSpan).RemoveAllLoggers();
        services.AddHttpClient(HttpClients.Linkedin, c => c.Timeout = TimeSpan.FromMinutes(1)).RemoveAllLoggers();
        services.AddHttpClient(HttpClients.LinkedinUpload, c => c.Timeout = Timeout.InfiniteTimeSpan).RemoveAllLoggers();
        services.AddHttpClient(HttpClients.Teams, c => c.Timeout = TimeSpan.FromMinutes(1)).RemoveAllLoggers();
        services.AddHttpClient(HttpClients.TeamsUpload, c => c.Timeout = Timeout.InfiniteTimeSpan).RemoveAllLoggers();

        // Infraestructura sin estado: singletons (el flow de Google y su almacén de tokens también lo son).
        services.AddSingleton<ExceptionHelper>();
        services.AddSingleton<ITusProtocol, TusProtocol>();
        services.AddSingleton<DbExecuter>();
        services.AddSingleton<VideoRepository>();
        services.AddSingleton<PublicationRepository>();
        services.AddSingleton<ConnectionRepository>();
        services.AddSingleton<ActivityRepository>();
        services.AddSingleton<CredentialRepository>();
        services.AddSingleton<ContentRepository>();
        services.AddSingleton<InboxRepository>();
        services.AddSingleton<VideoStorage>();
        services.AddSingleton<IProgressNotifier, ProgressNotifier>();
        services.AddSingleton<PlatformKeys>();
        services.AddSingleton<DbTokenDataStore>();
        services.AddSingleton<GoogleOAuthClient>();
        services.AddSingleton<YoutubeClientFactory>();
        services.AddSingleton<MetaGraphClient>();
        services.AddSingleton<TelegramBotClient>();
        services.AddSingleton<TelegramBots>();
        services.AddSingleton<WhatsAppClient>();
        services.AddSingleton<TiktokClient>();
        services.AddSingleton<TiktokTokens>();
        services.AddSingleton<LinkedinClient>();
        services.AddSingleton<LinkedinTokens>();
        services.AddSingleton<TeamsClient>();
        services.AddSingleton<TeamsTokens>();

        services.AddScoped<AuthService>();
        services.AddScoped<VideoService>();
        services.AddScoped<VideoUploadService>();
        services.AddScoped<PublicationService>();
        services.AddScoped<ConnectionService>();
        services.AddScoped<YoutubeAccountService>();
        services.AddScoped<MetaAccountService>();
        services.AddScoped<TelegramAccountService>();
        services.AddScoped<TiktokAccountService>();
        services.AddScoped<LinkedinAccountService>();
        services.AddScoped<TeamsAccountService>();
        services.AddScoped<CredentialService>();
        services.AddScoped<LibraryService>();
        services.AddScoped<ContentService>();
        services.AddScoped<InsightsService>();
        services.AddScoped<MetricsService>();
        services.AddScoped<IMetricsCollector, YoutubeMetricsCollector>();
        services.AddScoped<IMetricsCollector, FacebookMetricsCollector>();
        services.AddScoped<IMetricsCollector, InstagramMetricsCollector>();
        services.AddScoped<IMetricsCollector, LinkedinMetricsCollector>();

        // Una implementación por plataforma: el job y Conexiones las reciben todas como IEnumerable.
        services.AddScoped<PublisherServices>();
        services.AddScoped<YoutubeStatusPoller>();
        services.AddScoped<FacebookStatusPoller>();
        services.AddScoped<IPlatformPublisher, YoutubeVideoPublisher>();
        services.AddScoped<IPlatformPublisher, FacebookPublisher>();
        services.AddScoped<IPlatformPublisher, InstagramPublisher>();
        services.AddScoped<IPlatformPublisher, TelegramPublisher>();
        services.AddScoped<IPlatformPublisher, TiktokPublisher>();
        services.AddScoped<IPlatformPublisher, LinkedinPublisher>();
        services.AddScoped<IPlatformPublisher, TeamsPublisher>();
        services.AddScoped<PublicationProcessor>();

        services.AddScoped<InboxChannelServices>();
        services.AddScoped<IInboxChannel, FacebookInbox>();
        services.AddScoped<IInboxChannel, InstagramInbox>();
        services.AddScoped<IInboxChannel, WhatsAppInbox>();
        services.AddScoped<IInboxChannel, TelegramInbox>();
        services.AddScoped<IInboxChannel, YoutubeInbox>();
        services.AddScoped<IInboxChannel, TeamsInbox>();
        services.AddScoped<InboxChannels>();
        services.AddScoped<InboxProcessor>();
        services.AddScoped<InboxService>();
        services.AddScoped<InboxWebhookService>();
        services.AddScoped<HomeService>();

        services.AddJobs(configuration);
        return services;
    }

    private static void AddSettings(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<AppSettings>(configuration.GetSection("App"));
        services.Configure<StorageSettings>(configuration.GetSection("Storage"));
        services.Configure<GoogleSettings>(configuration.GetSection("Google"));
        services.Configure<MetaSettings>(configuration.GetSection("Meta"));
        services.Configure<TiktokSettings>(configuration.GetSection("Tiktok"));
        services.Configure<LinkedinSettings>(configuration.GetSection("Linkedin"));
        services.Configure<TeamsSettings>(configuration.GetSection("Teams"));
        services.Configure<VideoPublishSettings>(configuration.GetSection("Jobs:VideoPublish"));
        services.Configure<StorageCleanupSettings>(configuration.GetSection("Jobs:StorageCleanup"));
        services.Configure<TokenKeepAliveSettings>(configuration.GetSection("Jobs:TokenKeepAlive"));
        services.Configure<MetricsSettings>(configuration.GetSection("Jobs:Metrics"));
        services.Configure<InboxSettings>(configuration.GetSection("Jobs:Inbox"));
        services.Configure<PlatformsSettings>(configuration.GetSection("Platforms"));

        // Sin estas claves la app no puede funcionar: falla al arrancar con un mensaje claro.
        services.AddOptions<AuthSettings>().Bind(configuration.GetSection("Auth"))
            .Validate(s => s.JwtKey.Length >= 32, "Auth:JwtKey debe tener al menos 32 caracteres (user-secrets).")
            .Validate(s => s.AdminPasswordHash.StartsWith("pbkdf2$"), "Auth:AdminPasswordHash no está configurado. Genéralo con: dotnet run -- --hash-password <clave>")
            .ValidateOnStart();
        services.AddOptions<SecuritySettings>().Bind(configuration.GetSection("Security"))
            .Validate(s => IsBase64Key(s.SecretKey), "Security:SecretKey debe ser una clave de 32 bytes en base64 (user-secrets).")
            .ValidateOnStart();
    }

    private static void AddSecurity(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<SecretProtector>();
        services.AddSingleton<JwtTokenService>();
        services.AddSingleton<LoginThrottle>();
        services.AddSingleton<MediaLinks>();
        services.AddSingleton<WebhookSignature>();

        var auth = configuration.GetSection("Auth").Get<AuthSettings>() ?? new AuthSettings();
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = auth.JwtIssuer,
                    ValidateAudience = true,
                    ValidAudience = auth.JwtIssuer,
                    ValidateLifetime = true,
                    IssuerSigningKey = JwtTokenService.SigningKey(auth.JwtKey.Length > 0 ? auth.JwtKey : new string('-', 32)),
                    NameClaimType = AppClaims.Name,
                    ClockSkew = TimeSpan.FromMinutes(1)
                };
                // SignalR no puede mandar cabeceras en WebSocket: el token llega como access_token.
                options.Events = new JwtBearerEvents
                {
                    OnMessageReceived = context =>
                    {
                        string? token = context.Request.Query["access_token"];
                        if (!string.IsNullOrEmpty(token) && context.HttpContext.Request.Path.StartsWithSegments(HubPath))
                            context.Token = token;
                        return Task.CompletedTask;
                    }
                };
            });
        services.AddAuthorization();

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            // Por IP: un atacante no agota el cupo del administrador. El bloqueo progresivo lo hace LoginThrottle.
            options.AddPolicy(RateLimits.Login, context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "desconocida",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        });
    }

    private static void AddJobs(this IServiceCollection services, IConfiguration configuration)
    {
        if (configuration.GetValue("Jobs:VideoPublish:Enabled", true)) services.AddHostedService<VideoPublishJob>();
        if (configuration.GetValue("Jobs:StorageCleanup:Enabled", true)) services.AddHostedService<StorageCleanupJob>();
        if (configuration.GetValue("Jobs:TokenKeepAlive:Enabled", true)) services.AddHostedService<TokenKeepAliveJob>();
        if (configuration.GetValue("Jobs:Metrics:Enabled", true)) services.AddHostedService<MetricsJob>();
        if (configuration.GetValue("Jobs:Inbox:Enabled", true)) services.AddHostedService<InboxJob>();
    }

    private static bool IsBase64Key(string value)
    {
        Span<byte> buffer = stackalloc byte[64];
        return Convert.TryFromBase64String(value, buffer, out int written) && written == 32;
    }
}
