using Google.Apis.Auth.OAuth2.Responses;
using Google.Apis.Json;
using Microsoft.Extensions.Caching.Memory;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.External;
using YoutubeMeta.Api.Infrastructure.External.Meta;
using YoutubeMeta.Api.Infrastructure.External.Tiktok;
using YoutubeMeta.Api.Infrastructure.External.YouTube;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;
using YoutubeMeta.Api.Infrastructure.Storage;

#region RESPONSES
using StatusResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Responses.ConnectionsStatus>;
using TestResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Responses.ConnectionTestResponse>;
using CategoriesResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.CategoryItem>>;
using UsageResult = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Responses.UsageResponse>;
using PlatformResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<string>;
#endregion

namespace YoutubeMeta.Api.Application.Services;

/// <summary>
/// Conexiones de todas las plataformas: listado, prueba, preseleccionada, alias y quitar. Lo que es propio
/// de conectar cada plataforma vive en su *AccountService.
/// </summary>
public sealed class ConnectionService(
        ConnectionRepository connections,
        CredentialRepository credentials,
        VideoRepository videos,
        ActivityRepository activity,
        PlatformKeys keys,
        GoogleOAuthClient oauth,
        YoutubeClientFactory youtubeClients,
        TiktokClient tiktok,
        TiktokTokens tiktokTokens,
        MetaGraphClient graph,
        IEnumerable<IPlatformPublisher> publishers,
        IEnumerable<Inbox.IInboxChannel> inboxChannels,
        IOptions<PlatformsSettings> platforms,
        SecretProtector protector,
        VideoStorage storage,
        IMemoryCache cache,
        IProgressNotifier notifier,
        ExceptionHelper exception,
        ILogger<ConnectionService> logger)
{
    private const string CategoriesCacheKey = "youtube:categories";

    /// <summary>Por si aún no hay canal conectado o falla la consulta (IDs estándar de YouTube).</summary>
    private static readonly CategoryItem[] FallbackCategories =
    [
        new() { Id = "26", Title = "Instructivos y estilo" },
        new() { Id = "22", Title = "Gente y blogs" },
        new() { Id = "28", Title = "Ciencia y tecnología" },
        new() { Id = "27", Title = "Educación" },
        new() { Id = "24", Title = "Entretenimiento" },
        new() { Id = "2", Title = "Autos y vehículos" },
        new() { Id = "19", Title = "Viajes y eventos" },
        new() { Id = "17", Title = "Deportes" }
    ];

    private readonly Dictionary<string, IPlatformPublisher> _publishers = publishers.ToDictionary(p => p.Platform);
    private readonly Dictionary<string, Inbox.IInboxChannel> _inboxChannels = inboxChannels.ToDictionary(c => c.Platform);

    public Task<StatusResponse> Status(CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<StatusResponse>(async () =>
        {
            var all = await connections.List(cancellationToken);
            var google = (await keys.GoogleAsync(cancellationToken)).Settings;
            var tiktokKey = (await keys.TiktokAsync(cancellationToken)).Settings;
            var linkedinApp = (await keys.LinkedinAsync(false, cancellationToken)).Settings;
            var linkedinOrgApp = (await keys.LinkedinAsync(true, cancellationToken)).Settings;
            var teamsApp = (await keys.TeamsAsync(cancellationToken)).Settings;
            var bots = (await credentials.List(cancellationToken)).Count(c => c.Platform == Platforms.Telegram);

            return StatusResponse.Ok(new ConnectionsStatus
            {
                GoogleConfigured = google.IsConfigured,
                GoogleRedirectUri = TextHelper.NullIfBlank(google.RedirectUri),
                TiktokConfigured = tiktokKey.IsConfigured,
                TiktokRedirectUri = TextHelper.NullIfBlank(tiktokKey.RedirectUri),
                LinkedinConfigured = linkedinApp.IsConfigured,
                LinkedinRedirectUri = TextHelper.NullIfBlank(linkedinApp.RedirectUri),
                LinkedinOrgConfigured = linkedinOrgApp.IsConfigured,
                LinkedinOrgRedirectUri = TextHelper.NullIfBlank(linkedinOrgApp.RedirectUri),
                TeamsConfigured = teamsApp.IsConfigured,
                TeamsRedirectUri = TextHelper.NullIfBlank(teamsApp.RedirectUri),
                TelegramBots = bots,
                GraphVersion = graph.GraphVersion,
                Accounts = all.Where(x => x.StatusCode != ConnectionStatus.Revoked).ToList(),
                History = all.Where(x => x.StatusCode == ConnectionStatus.Revoked).ToList()
            });
        });

    public Task<TestResponse> Test(int id, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<TestResponse>(async () =>
        {
            var connection = await connections.Get(id, cancellationToken);
            if (connection == null || connection.StatusCode == ConnectionStatus.Revoked) return TestResponse.Fail("La conexión no existe.");

            var result = await TestAsync(connection, cancellationToken);
            await connections.TestSave(id, result.IsOk, result.Message, cancellationToken);
            await notifier.ConnectionChangedAsync(connection.Platform, cancellationToken);
            return TestResponse.Ok(new ConnectionTestResponse { IsOk = result.IsOk, Message = result.Message });
        });

    /// <summary>La cuenta preseleccionada (★) al publicar en su plataforma.</summary>
    public Task<PlatformResponse> SetDefault(int id, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<PlatformResponse>(async () =>
        {
            string? platform = await connections.DefaultSet(id, cancellationToken);
            if (platform == null) return PlatformResponse.Fail("La cuenta no existe.");
            await notifier.ConnectionChangedAsync(platform, cancellationToken);
            return PlatformResponse.Ok(platform);
        });

    public Task<PlatformResponse> SaveAlias(int id, ConnectionAliasRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<PlatformResponse>(async () =>
        {
            string? alias = request.Alias?.Trim();
            if (alias?.Length > 100) return PlatformResponse.Fail("El nombre corto admite como máximo 100 caracteres.");

            string? platform = await connections.AliasSave(id, alias, cancellationToken);
            if (platform == null) return PlatformResponse.Fail("La cuenta no existe.");
            await notifier.ConnectionChangedAsync(platform, cancellationToken);
            return PlatformResponse.Ok(platform);
        });

    /// <summary>
    /// Quitar revoca el acceso en Google o TikTok en el acto y borra el token (política III.D.2 de YouTube).
    /// Solo se cancela lo pendiente de ESTA cuenta; las demás siguen igual.
    /// </summary>
    public Task<TestResponse> Disconnect(int id, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<TestResponse>(async () =>
        {
            var deleted = await connections.Delete(id, userName, cancellationToken);
            if (deleted == null) return TestResponse.Fail("La conexión no existe.");

            string message;
            try
            {
                message = deleted.Platform switch
                {
                    Platforms.YouTube => await RevokeGoogleAsync(deleted.SecretCipher, cancellationToken),
                    Platforms.TikTok => await RevokeTiktokAsync(deleted.SecretCipher, cancellationToken),
                    Platforms.Telegram => "Canal quitado. El bot sigue siendo administrador del canal: quítalo en Telegram si ya no lo usas.",
                    _ => "Cuenta quitada y token borrado."
                };
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // La cuenta ya está quitada: un fallo al revocar no debe parecer que no se quitó.
                logger.LogWarning(ex, "No se pudo revocar el acceso de la cuenta {Id} en {Platform}.", id, deleted.Platform);
                message = "Cuenta quitada y token borrado. No se pudo revocar el acceso en la plataforma: quítalo desde su configuración de apps conectadas.";
            }

            await notifier.ConnectionChangedAsync(deleted.Platform, cancellationToken);
            return TestResponse.Ok(new ConnectionTestResponse { IsOk = true, Message = message });
        });

    public Task<CategoriesResponse> Categories(string regionCode, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CategoriesResponse>(async () =>
        {
            if (cache.TryGetValue(CategoriesCacheKey, out IReadOnlyList<CategoryItem>? cached) && cached != null)
                return CategoriesResponse.Ok(cached);

            var connection = await connections.GetDefault(Platforms.YouTube, cancellationToken);
            if (connection == null) return CategoriesResponse.Ok(FallbackCategories);

            try
            {
                using var youtube = await youtubeClients.CreateAsync(connection.ConnectionKey, TimeSpan.FromSeconds(30), cancellationToken);
                if (youtube == null) return CategoriesResponse.Ok(FallbackCategories);

                var request = youtube.VideoCategories.List("snippet");
                request.RegionCode = regionCode;
                request.Hl = "es";
                var response = await request.ExecuteAsync(cancellationToken);
                await activity.QuotaAdd(QuotaBuckets.General, 1, connection.Id, CancellationToken.None);

                IReadOnlyList<CategoryItem> items = (response.Items ?? [])
                    .Where(c => c.Snippet?.Assignable == true)
                    .Select(c => new CategoryItem { Id = c.Id, Title = c.Snippet.Title })
                    .OrderBy(c => c.Title, StringComparer.CurrentCultureIgnoreCase)
                    .ToList();

                if (items.Count == 0) return CategoriesResponse.Ok(FallbackCategories);
                cache.Set(CategoriesCacheKey, items, TimeSpan.FromHours(24));
                return CategoriesResponse.Ok(items);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "No se pudieron leer las categorías de YouTube; se usan las de respaldo.");
                return CategoriesResponse.Ok(FallbackCategories);
            }
        });

    public Task<UsageResult> Usage(CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<UsageResult>(async () =>
        {
            var (totals, channels) = await activity.Quota(cancellationToken);
            return UsageResult.Ok(new UsageResponse
            {
                DayPt = TimeClock.PacificToday,
                Uploads = totals.FirstOrDefault(q => q.Bucket == QuotaBuckets.Uploads)?.Units ?? 0,
                UploadsLimit = QuotaBuckets.UploadsLimit,
                Units = totals.FirstOrDefault(q => q.Bucket == QuotaBuckets.General)?.Units ?? 0,
                UnitsLimit = QuotaBuckets.GeneralLimit,
                ResetsAtUtc = TimeClock.NextPacificMidnightUtc().AddMinutes(-5),
                Channels = channels,
                StorageRoot = storage.Root,
                StorageUsedBytes = await videos.UsedBytes(cancellationToken),
                StorageFreeBytes = storage.FreeBytes()
            });
        });

    /// <summary>
    /// Prueba las cuentas conectadas que llevan más de <paramref name="maxAge"/> sin probarse: el refresh token de
    /// Google muere tras 6 meses sin uso y el de TikTok tras 180 días.
    /// </summary>
    public async Task KeepAliveAsync(TimeSpan maxAge, CancellationToken cancellationToken)
    {
        DateTime threshold = TimeClock.UtcNow - maxAge;
        foreach (var connection in (await connections.ActiveList(cancellationToken))
                     .Where(c => platforms.Value.IsEnabled(c.Platform) && (c.LastTestAt is null || c.LastTestAt < threshold)))
        {
            var result = await TestAsync(connection, cancellationToken);
            await connections.TestSave(connection.Id, result.IsOk, result.Message, cancellationToken);
            if (!result.IsOk) logger.LogWarning("Prueba periódica de {Platform} «{Name}» fallida: {Message}", connection.Platform, connection.DisplayName, result.Message);
        }
    }

    /// <summary>Listas de reproducción de un canal de YouTube, para elegir dónde añadir el video al publicar.</summary>
    public Task<CustomTransactionResponse<IReadOnlyList<PlaylistOption>>> YoutubePlaylists(int connectionId, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<IReadOnlyList<PlaylistOption>>>(async () =>
        {
            var connection = await connections.Get(connectionId, cancellationToken);
            if (connection?.Platform != Platforms.YouTube || _publishers.GetValueOrDefault(Platforms.YouTube) is not YoutubeVideoPublisher youtube)
                return CustomTransactionResponse<IReadOnlyList<PlaylistOption>>.Fail("El canal de YouTube no existe.");
            return CustomTransactionResponse<IReadOnlyList<PlaylistOption>>.Ok(await youtube.PlaylistsAsync(connection, cancellationToken));
        });

    /// <summary>La prueba la hace el publicador de la plataforma o, si no publica (WhatsApp), su canal de la bandeja.</summary>
    private async Task<ConnectionTest> TestAsync(ConnectionRow connection, CancellationToken cancellationToken)
    {
        try
        {
            if (_publishers.TryGetValue(connection.Platform, out var publisher)) return await publisher.TestAsync(connection, cancellationToken);
            if (_inboxChannels.TryGetValue(connection.Platform, out var channel) && await channel.TestAsync(connection, cancellationToken) is { } test) return test;
            return new(false, "Plataforma no soportada.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Prueba de {Platform} «{Name}»: error inesperado.", connection.Platform, connection.DisplayName);
            return new(false, $"No se pudo comprobar la conexión con {Platforms.Label(connection.Platform)} ({ex.GetType().Name}). Prueba de nuevo en unos minutos.");
        }
    }

    private async Task<string> RevokeGoogleAsync(string? cipher, CancellationToken cancellationToken)
    {
        if (protector.UnprotectOrNull(cipher) is not { } json) return "Canal quitado.";

        var token = NewtonsoftJsonSerializer.Instance.Deserialize<TokenResponse>(json);
        string? revocable = token.RefreshToken ?? token.AccessToken;
        bool revoked = revocable != null && await oauth.RevokeAsync(revocable, cancellationToken);
        return revoked
            ? "Canal quitado y acceso revocado en Google."
            : "Canal quitado. Google no confirmó la revocación: puedes quitar el acceso en myaccount.google.com/permissions.";
    }

    private async Task<string> RevokeTiktokAsync(string? cipher, CancellationToken cancellationToken)
    {
        var token = tiktokTokens.Read(cipher);
        if (token == null) return "Cuenta quitada.";

        var settings = (await keys.TiktokAsync(cancellationToken)).Settings;
        bool revoked = settings.IsConfigured && await tiktok.RevokeAsync(settings, token.AccessToken, cancellationToken);
        return revoked
            ? "Cuenta quitada y acceso revocado en TikTok."
            : "Cuenta quitada. TikTok no confirmó la revocación: puedes quitar el acceso en la app (Ajustes › Seguridad › Apps y servicios).";
    }

}
