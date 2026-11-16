using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.WebUtilities;
using static YoutubeMeta.Api.Infrastructure.External.JsonFields;

namespace YoutubeMeta.Api.Infrastructure.External.Tiktok;

/// <summary>
/// Login Kit (OAuth v2) y Content Posting API de TikTok. El token va en Authorization: Bearer; los
/// HttpClient de TikTok no registran URLs. Scopes: perfil básico, publicar directo y subir como borrador.
/// </summary>
public sealed class TiktokClient(IHttpClientFactory httpClientFactory)
{
    public const string StatePurpose = "tiktok-account-state";
    public const string Scopes = "user.info.basic,video.publish,video.upload";

    private const string AuthorizeEndpoint = "https://www.tiktok.com/v2/auth/authorize/";
    private const string Api = "https://open.tiktokapis.com/v2/";

    public static string BuildAuthorizeUrl(TiktokSettings settings, string state) =>
        QueryHelpers.AddQueryString(AuthorizeEndpoint, new Dictionary<string, string?>
        {
            ["client_key"] = settings.ClientKey,
            ["scope"] = Scopes,
            ["response_type"] = "code",
            ["redirect_uri"] = settings.RedirectUri,
            ["state"] = state
        });

    #region OAUTH
    public Task<TiktokResult<TiktokToken>> ExchangeCodeAsync(TiktokSettings settings, string code, CancellationToken cancellationToken) =>
        TokenAsync(new Dictionary<string, string>
        {
            ["client_key"] = settings.ClientKey,
            ["client_secret"] = settings.ClientSecret,
            ["code"] = code,
            ["grant_type"] = "authorization_code",
            ["redirect_uri"] = settings.RedirectUri
        }, cancellationToken);

    /// <summary>Cada renovación entrega un refresh token nuevo: el anterior deja de servir.</summary>
    public Task<TiktokResult<TiktokToken>> RefreshAsync(TiktokSettings settings, string refreshToken, CancellationToken cancellationToken) =>
        TokenAsync(new Dictionary<string, string>
        {
            ["client_key"] = settings.ClientKey,
            ["client_secret"] = settings.ClientSecret,
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken
        }, cancellationToken);

    public async Task<bool> RevokeAsync(TiktokSettings settings, string accessToken, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.Tiktok);
        using var response = await client.PostAsync($"{Api}oauth/revoke/", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_key"] = settings.ClientKey,
            ["client_secret"] = settings.ClientSecret,
            ["token"] = accessToken
        }), cancellationToken);
        return response.IsSuccessStatusCode;
    }

    private async Task<TiktokResult<TiktokToken>> TokenAsync(Dictionary<string, string> fields, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.Tiktok);
        using var response = await client.PostAsync($"{Api}oauth/token/", new FormUrlEncodedContent(fields), cancellationToken);
        var root = await ReadJsonAsync(response, cancellationToken);

        if (root.TryGetProperty("access_token", out var access))
        {
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            return TiktokResult<TiktokToken>.Success(new TiktokToken
            {
                AccessToken = access.GetString() ?? string.Empty,
                RefreshToken = Text(root, "refresh_token"),
                ExpiresAt = now + Number(root, "expires_in"),
                RefreshExpiresAt = now + Number(root, "refresh_expires_in"),
                OpenId = Text(root, "open_id"),
                Scope = Text(root, "scope")
            });
        }

        string code = root.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() ?? "token" : "token";
        return TiktokResult<TiktokToken>.Fail(new TiktokError(code, Text(root, "error_description"), (int)response.StatusCode));
    }
    #endregion

    #region USUARIO
    public async Task<TiktokResult<TiktokUser>> UserInfoAsync(string accessToken, CancellationToken cancellationToken)
    {
        var (data, error) = await SendAsync(HttpMethod.Get, "user/info/?fields=open_id,avatar_url,display_name,username", accessToken, null, cancellationToken);
        if (error != null) return TiktokResult<TiktokUser>.Fail(error);

        var user = data.GetProperty("user");
        return TiktokResult<TiktokUser>.Success(new TiktokUser(Text(user, "open_id"), Text(user, "display_name"), Text(user, "username"), Text(user, "avatar_url")));
    }

    public async Task<TiktokResult<TiktokCreatorInfo>> CreatorInfoAsync(string accessToken, CancellationToken cancellationToken)
    {
        var (data, error) = await SendAsync(HttpMethod.Post, "post/publish/creator_info/query/", accessToken, new JsonObject(), cancellationToken);
        if (error != null) return TiktokResult<TiktokCreatorInfo>.Fail(error);

        return TiktokResult<TiktokCreatorInfo>.Success(new TiktokCreatorInfo
        {
            Nickname = Text(data, "creator_nickname"),
            Username = Text(data, "creator_username"),
            AvatarUrl = Text(data, "creator_avatar_url"),
            PrivacyOptions = data.TryGetProperty("privacy_level_options", out var p) && p.ValueKind == JsonValueKind.Array
                ? p.EnumerateArray().Select(x => x.GetString() ?? string.Empty).Where(x => x.Length > 0).ToArray()
                : [],
            CommentDisabled = Flag(data, "comment_disabled"),
            DuetDisabled = Flag(data, "duet_disabled"),
            StitchDisabled = Flag(data, "stitch_disabled"),
            MaxDurationSec = (int)Number(data, "max_video_post_duration_sec")
        });
    }
    #endregion

    #region PUBLICACIÓN
    /// <summary>Publicación directa (post_info) o, con postInfo = null, borrador en la bandeja de la app.</summary>
    public async Task<TiktokResult<(string PublishId, string UploadUrl)>> InitAsync(string accessToken, JsonObject? postInfo, TiktokChunks chunks, CancellationToken cancellationToken)
    {
        var body = new JsonObject
        {
            ["source_info"] = new JsonObject
            {
                ["source"] = "FILE_UPLOAD",
                ["video_size"] = chunks.FileSize,
                ["chunk_size"] = chunks.ChunkSize,
                ["total_chunk_count"] = chunks.Count
            }
        };
        if (postInfo != null) body["post_info"] = postInfo;

        string path = postInfo != null ? "post/publish/video/init/" : "post/publish/inbox/video/init/";
        var (data, error) = await SendAsync(HttpMethod.Post, path, accessToken, body, cancellationToken);
        return error != null
            ? TiktokResult<(string, string)>.Fail(error)
            : TiktokResult<(string, string)>.Success((Text(data, "publish_id"), Text(data, "upload_url")));
    }

    /// <summary>
    /// Fotos (modo foto, hasta 35): TikTok las descarga desde URLs de un dominio verificado en su portal. Directo
    /// (DIRECT_POST) o borrador (MEDIA_UPLOAD). Devuelve el publish_id que luego se consulta como un video.
    /// </summary>
    public async Task<TiktokResult<string>> PhotoInitAsync(string accessToken, JsonObject postInfo, IReadOnlyList<string> imageUrls, bool inbox, CancellationToken cancellationToken)
    {
        var body = new JsonObject
        {
            ["post_info"] = postInfo,
            ["source_info"] = new JsonObject
            {
                ["source"] = "PULL_FROM_URL",
                ["photo_cover_index"] = 0,
                ["photo_images"] = new JsonArray([.. imageUrls.Select(u => JsonValue.Create(u))])
            },
            ["post_mode"] = inbox ? "MEDIA_UPLOAD" : "DIRECT_POST",
            ["media_type"] = "PHOTO"
        };
        var (data, error) = await SendAsync(HttpMethod.Post, "post/publish/content/init/", accessToken, body, cancellationToken);
        return error != null ? TiktokResult<string>.Fail(error) : TiktokResult<string>.Success(Text(data, "publish_id"));
    }

    /// <summary>PUT de un trozo con Content-Range. 206 = faltan trozos, 201 = archivo completo.</summary>
    public async Task<TiktokResult<bool>> UploadChunkAsync(string uploadUrl, string filePath, string contentType, long start, long length, long fileSize, Action<long> progress, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.TiktokUpload);
        using var content = new FileSliceContent(filePath, start, length, sent => progress(start + sent), contentType);
        content.Headers.ContentRange = new ContentRangeHeaderValue(start, start + length - 1, fileSize);

        using var response = await client.PutAsync(uploadUrl, content, cancellationToken);
        int status = (int)response.StatusCode;
        return status is 200 or 201 or 206
            ? TiktokResult<bool>.Success(status == 201)
            : TiktokResult<bool>.Fail(new TiktokError(status == 403 ? "upload_url_expired" : $"upload_http_{status}", $"TikTok rechazó el trozo (HTTP {status}).", status));
    }

    public async Task<TiktokResult<TiktokPostStatus>> StatusAsync(string accessToken, string publishId, CancellationToken cancellationToken)
    {
        var (data, error) = await SendAsync(HttpMethod.Post, "post/publish/status/fetch/", accessToken, new JsonObject { ["publish_id"] = publishId }, cancellationToken);
        if (error != null) return TiktokResult<TiktokPostStatus>.Fail(error);

        // Así lo escribe TikTok: «publicaly».
        string? postId = data.TryGetProperty("publicaly_available_post_id", out var ids) && ids.ValueKind == JsonValueKind.Array && ids.GetArrayLength() > 0
            ? ids[0].ToString() : null;
        return TiktokResult<TiktokPostStatus>.Success(new TiktokPostStatus(Text(data, "status"), Text(data, "fail_reason"), postId));
    }
    #endregion

    private async Task<(JsonElement Data, TiktokError? Error)> SendAsync(HttpMethod method, string path, string accessToken, JsonObject? body, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.Tiktok);
        using var request = new HttpRequestMessage(method, Api + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        if (body != null) request.Content = JsonContent.Create(body);

        using var response = await client.SendAsync(request, cancellationToken);
        var root = await ReadJsonAsync(response, cancellationToken);

        var error = root.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.Object ? e : default;
        string code = error.ValueKind == JsonValueKind.Object ? Text(error, "code") : string.Empty;
        if (code is "" or "ok" && response.IsSuccessStatusCode)
            return (root.TryGetProperty("data", out var data) ? data : default, null);

        return (default, new TiktokError(code is "" ? $"http_{(int)response.StatusCode}" : code,
            error.ValueKind == JsonValueKind.Object ? Text(error, "message") : $"TikTok respondió HTTP {(int)response.StatusCode}.",
            (int)response.StatusCode));
    }

    /// <summary>A diferencia de <see cref="JsonFields.ReadJsonAsync"/>, siempre un objeto (vacío si no hay JSON).</summary>
    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        string body = await response.Content.ReadAsStringAsync(cancellationToken);
        try
        {
            return JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body).RootElement.Clone();
        }
        catch (JsonException)
        {
            return JsonDocument.Parse("{}").RootElement.Clone();
        }
    }

    private static bool Flag(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
}

/// <summary>Token guardado (cifrado) en la conexión. Fechas en segundos Unix.</summary>
public sealed class TiktokToken
{
    public string AccessToken { get; set; } = string.Empty;
    public string RefreshToken { get; set; } = string.Empty;
    public long ExpiresAt { get; set; }
    public long RefreshExpiresAt { get; set; }
    public string OpenId { get; set; } = string.Empty;
    public string Scope { get; set; } = string.Empty;

    [System.Text.Json.Serialization.JsonIgnore]
    public DateTime RefreshExpiresAtUtc => DateTimeOffset.FromUnixTimeSeconds(RefreshExpiresAt).UtcDateTime;
}

/// <summary>
/// Reglas de trozos de TikTok: de 5 a 64 MB, total = floor(tamaño / trozo) y el último absorbe el resto
/// (hasta 128 MB). Un archivo de menos de 5 MB va en un solo trozo.
/// </summary>
public sealed record TiktokChunks(long FileSize, long ChunkSize, int Count)
{
    private const long MinChunk = 5L * 1024 * 1024;
    private const long MaxChunk = 64L * 1024 * 1024;

    public static TiktokChunks For(long fileSize, int preferredMb)
    {
        if (fileSize < MinChunk) return new(fileSize, fileSize, 1);
        long chunk = Math.Clamp(preferredMb * 1024L * 1024L, MinChunk, MaxChunk);
        chunk = Math.Min(chunk, fileSize);
        return new(fileSize, chunk, (int)(fileSize / chunk));
    }

    public long Start(int index) => index * ChunkSize;

    public long Length(int index) => index == Count - 1 ? FileSize - Start(index) : ChunkSize;
}

public sealed record TiktokError(string Code, string Message, int HttpStatus);

public sealed record TiktokResult<T>(T? Data, TiktokError? Error)
{
    public bool Ok => Error is null;
    public static TiktokResult<T> Success(T data) => new(data, null);
    public static TiktokResult<T> Fail(TiktokError error) => new(default, error);
}

public sealed record TiktokUser(string OpenId, string DisplayName, string Username, string AvatarUrl);

public sealed record TiktokPostStatus(string Status, string? FailReason, string? PostId);
