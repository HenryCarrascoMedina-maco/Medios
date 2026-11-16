using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.WebUtilities;
using static YoutubeMeta.Api.Infrastructure.External.JsonFields;

namespace YoutubeMeta.Api.Infrastructure.External.Linkedin;

/// <summary>
/// OAuth 2.0 y API REST de LinkedIn (Posts, Images, Videos, Documents, Social Actions). Cada llamada lleva la
/// cabecera LinkedIn-Version (AAAAMM, configurable) y X-Restli-Protocol-Version 2.0.0. Los HttpClient de LinkedIn
/// no registran URLs ni tokens.
/// </summary>
public sealed partial class LinkedinClient(IHttpClientFactory httpClientFactory)
{
    public const string StatePurpose = "linkedin-account-state";
    public const string OrgStatePurpose = "linkedin-org-account-state";

    /// <summary>Perfil personal: productos «Sign In with LinkedIn using OpenID Connect» y «Share on LinkedIn».</summary>
    public const string MemberScopes = "openid profile w_member_social";
    /// <summary>Páginas de empresa: Community Management API (publicar, listar páginas administradas y leer sus posts).</summary>
    public const string OrgScopes = "w_organization_social rw_organization_admin r_organization_social";

    private const string AuthorizeEndpoint = "https://www.linkedin.com/oauth/v2/authorization";
    private const string TokenEndpoint = "https://www.linkedin.com/oauth/v2/accessToken";
    private const string Api = "https://api.linkedin.com/";
    public const string PostUrlPrefix = "https://www.linkedin.com/feed/update/";

    /// <summary>Roles de página con los que se puede publicar en nombre de la empresa.</summary>
    private static readonly string[] PublishingRoles = ["ADMINISTRATOR", "CONTENT_ADMINISTRATOR", "DIRECT_SPONSORED_CONTENT_POSTER"];

    public static string BuildAuthorizeUrl(LinkedinApp app, string state) =>
        QueryHelpers.AddQueryString(AuthorizeEndpoint, new Dictionary<string, string?>
        {
            ["response_type"] = "code",
            ["client_id"] = app.ClientId,
            ["redirect_uri"] = app.RedirectUri,
            ["state"] = state,
            ["scope"] = app.IsOrganization ? OrgScopes : MemberScopes
        });

    public static string PostUrl(string postUrn) => $"{PostUrlPrefix}{postUrn}/";

    #region OAUTH
    public Task<LinkedinResult<LinkedinToken>> ExchangeCodeAsync(LinkedinApp app, string code, CancellationToken cancellationToken) =>
        TokenAsync(app, new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = app.RedirectUri,
            ["client_id"] = app.ClientId,
            ["client_secret"] = app.ClientSecret
        }, cancellationToken);

    /// <summary>Solo apps aprobadas reciben refresh token; las de autoservicio reconectan cada 60 días.</summary>
    public Task<LinkedinResult<LinkedinToken>> RefreshAsync(LinkedinApp app, string refreshToken, CancellationToken cancellationToken) =>
        TokenAsync(app, new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
            ["client_id"] = app.ClientId,
            ["client_secret"] = app.ClientSecret
        }, cancellationToken);

    private async Task<LinkedinResult<LinkedinToken>> TokenAsync(LinkedinApp app, Dictionary<string, string> fields, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.Linkedin);
        using var response = await client.PostAsync(TokenEndpoint, new FormUrlEncodedContent(fields), cancellationToken);
        var root = await ReadJsonAsync(response, cancellationToken);

        if (response.IsSuccessStatusCode && root.TryGetProperty("access_token", out var access))
        {
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            long refreshIn = Number(root, "refresh_token_expires_in");
            return LinkedinResult<LinkedinToken>.Success(new LinkedinToken
            {
                AccessToken = access.GetString() ?? string.Empty,
                ExpiresAt = now + Number(root, "expires_in"),
                RefreshToken = TextHelper.NullIfBlank(Text(root, "refresh_token")),
                RefreshExpiresAt = refreshIn > 0 ? now + refreshIn : null,
                Scope = Text(root, "scope"),
                IsOrganization = app.IsOrganization
            });
        }
        return LinkedinResult<LinkedinToken>.Fail(ErrorFrom(response.StatusCode, root, "token"));
    }
    #endregion

    #region CUENTAS
    /// <summary>Perfil del miembro (OpenID Connect): sub = id de la persona.</summary>
    public async Task<LinkedinResult<LinkedinMember>> MemberAsync(string accessToken, string version, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, "v2/userinfo", accessToken, version, null, cancellationToken);
        if (error != null) return LinkedinResult<LinkedinMember>.Fail(error);
        return LinkedinResult<LinkedinMember>.Success(new LinkedinMember(Text(root, "sub"), Text(root, "name"), TextHelper.NullIfBlank(Text(root, "picture"))));
    }

    /// <summary>Páginas de empresa en las que el usuario puede publicar (administrador o administrador de contenido).</summary>
    public async Task<LinkedinResult<IReadOnlyList<LinkedinOrganization>>> OrganizationsAsync(string accessToken, string version, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, "rest/organizationAcls?q=roleAssignee&state=APPROVED&count=100", accessToken, version, null, cancellationToken);
        if (error != null) return LinkedinResult<IReadOnlyList<LinkedinOrganization>>.Fail(error);

        var urns = Elements(root)
            .Where(e => PublishingRoles.Contains(Text(e, "role")))
            .Select(e => Text(e, "organization"))
            .Where(urn => urn.StartsWith("urn:li:organization:", StringComparison.Ordinal))
            .Distinct()
            .ToList();

        var list = new List<LinkedinOrganization>();
        foreach (string urn in urns)
        {
            string id = urn["urn:li:organization:".Length..];
            var (org, orgError) = await SendAsync(HttpMethod.Get, $"rest/organizations/{id}", accessToken, version, null, cancellationToken);
            string name = orgError == null ? Text(org, "localizedName") : string.Empty;
            string vanity = orgError == null ? Text(org, "vanityName") : string.Empty;
            list.Add(new LinkedinOrganization(urn, name.Length > 0 ? name : $"Página {id}", TextHelper.NullIfBlank(vanity)));
        }
        return LinkedinResult<IReadOnlyList<LinkedinOrganization>>.Success(list);
    }
    #endregion

    #region ARCHIVOS
    /// <summary>Imagen o documento: LinkedIn devuelve una URL de subida y el URN del recurso.</summary>
    public async Task<LinkedinResult<LinkedinUploadTarget>> InitializeUploadAsync(string resource, string owner, string accessToken, string version, CancellationToken cancellationToken)
    {
        var body = new JsonObject { ["initializeUploadRequest"] = new JsonObject { ["owner"] = owner } };
        var (root, error) = await SendAsync(HttpMethod.Post, $"rest/{resource}?action=initializeUpload", accessToken, version, body, cancellationToken);
        if (error != null) return LinkedinResult<LinkedinUploadTarget>.Fail(error);

        var value = root.GetProperty("value");
        string urn = Text(value, resource == LinkedinResources.Images ? "image" : "document");
        return LinkedinResult<LinkedinUploadTarget>.Success(new LinkedinUploadTarget(urn, Text(value, "uploadUrl")));
    }

    /// <summary>Video: subida por partes con los rangos que indica LinkedIn.</summary>
    public async Task<LinkedinResult<LinkedinVideoUpload>> InitializeVideoAsync(string owner, long fileSize, string accessToken, string version, CancellationToken cancellationToken)
    {
        var body = new JsonObject
        {
            ["initializeUploadRequest"] = new JsonObject
            {
                ["owner"] = owner,
                ["fileSizeBytes"] = fileSize,
                ["uploadCaptions"] = false,
                ["uploadThumbnail"] = false
            }
        };
        var (root, error) = await SendAsync(HttpMethod.Post, "rest/videos?action=initializeUpload", accessToken, version, body, cancellationToken);
        if (error != null) return LinkedinResult<LinkedinVideoUpload>.Fail(error);

        var value = root.GetProperty("value");
        var parts = value.TryGetProperty("uploadInstructions", out var instructions) && instructions.ValueKind == JsonValueKind.Array
            ? instructions.EnumerateArray().Select(i => new LinkedinUploadPart(Text(i, "uploadUrl"), Number(i, "firstByte"), Number(i, "lastByte"))).ToList()
            : [];
        return LinkedinResult<LinkedinVideoUpload>.Success(new LinkedinVideoUpload(Text(value, "video"), Text(value, "uploadToken"), parts));
    }

    public async Task<LinkedinResult<bool>> FinalizeVideoAsync(string videoUrn, string uploadToken, IReadOnlyList<string> etags, string accessToken, string version, CancellationToken cancellationToken)
    {
        var body = new JsonObject
        {
            ["finalizeUploadRequest"] = new JsonObject
            {
                ["video"] = videoUrn,
                ["uploadToken"] = uploadToken,
                ["uploadedPartIds"] = new JsonArray([.. etags.Select(e => JsonValue.Create(e))])
            }
        };
        var (_, error) = await SendAsync(HttpMethod.Post, "rest/videos?action=finalizeUpload", accessToken, version, body, cancellationToken);
        return error == null ? LinkedinResult<bool>.Success(true) : LinkedinResult<bool>.Fail(error);
    }

    /// <summary>Sube [offset, offset+length) del archivo a una URL de subida. Devuelve el ETag (lo pide finalizeUpload en videos).</summary>
    public async Task<LinkedinResult<string>> UploadPartAsync(string uploadUrl, string filePath, long offset, long length, string accessToken, Action<long>? progress, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.LinkedinUpload);
        using var request = new HttpRequestMessage(HttpMethod.Put, uploadUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Content = new FileSliceContent(filePath, offset, length, progress);

        try
        {
            using var response = await client.SendAsync(request, cancellationToken);
            if (response.IsSuccessStatusCode)
                return LinkedinResult<string>.Success(response.Headers.ETag?.Tag.Trim('"') ?? (response.Headers.TryGetValues("ETag", out var e) ? e.First().Trim('"') : string.Empty));
            var root = await ReadJsonAsync(response, cancellationToken);
            return LinkedinResult<string>.Fail(ErrorFrom(response.StatusCode, root, "upload"));
        }
        catch (HttpRequestException ex)
        {
            return LinkedinResult<string>.Fail(new LinkedinError(0, "NETWORK", ex.Message, true));
        }
    }

    /// <summary>Estado de un recurso subido: PROCESSING, AVAILABLE, PROCESSING_FAILED, WAITING_UPLOAD…</summary>
    public async Task<LinkedinResult<string>> AssetStatusAsync(string resource, string urn, string accessToken, string version, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"rest/{resource}/{Uri.EscapeDataString(urn)}", accessToken, version, null, cancellationToken);
        return error == null ? LinkedinResult<string>.Success(Text(root, "status")) : LinkedinResult<string>.Fail(error);
    }
    #endregion

    #region POSTS
    /// <summary>Devuelve el URN del post (cabecera x-restli-id).</summary>
    public async Task<LinkedinResult<string>> CreatePostAsync(LinkedinPost post, string accessToken, string version, CancellationToken cancellationToken)
    {
        var body = new JsonObject
        {
            ["author"] = post.Author,
            ["commentary"] = Commentary(post.Text),
            ["visibility"] = post.Visibility,
            ["distribution"] = new JsonObject
            {
                ["feedDistribution"] = "MAIN_FEED",
                ["targetEntities"] = new JsonArray(),
                ["thirdPartyDistributionChannels"] = new JsonArray()
            },
            ["lifecycleState"] = "PUBLISHED",
            ["isReshareDisabledByAuthor"] = false
        };
        if (post.Content != null) body["content"] = post.Content;

        var (_, error, headers) = await SendWithHeadersAsync(HttpMethod.Post, "rest/posts", accessToken, version, body, cancellationToken);
        if (error != null) return LinkedinResult<string>.Fail(error);
        string? urn = headers?.TryGetValues("x-restli-id", out var values) == true ? values.FirstOrDefault() : null;
        return string.IsNullOrEmpty(urn)
            ? LinkedinResult<string>.Fail(new LinkedinError(0, "NO_ID", "LinkedIn no devolvió el identificador del post.", false))
            : LinkedinResult<string>.Success(urn);
    }

    /// <summary>Últimos posts de un autor (solo páginas de empresa: los perfiles necesitan un permiso restringido).</summary>
    public async Task<LinkedinResult<IReadOnlyList<LinkedinPostSummary>>> RecentPostsAsync(string author, string accessToken, string version, CancellationToken cancellationToken)
    {
        string path = $"rest/posts?author={Uri.EscapeDataString(author)}&q=author&count=10&sortBy=LAST_MODIFIED";
        var (root, error) = await SendAsync(HttpMethod.Get, path, accessToken, version, null, cancellationToken, finder: true);
        if (error != null) return LinkedinResult<IReadOnlyList<LinkedinPostSummary>>.Fail(error);
        return LinkedinResult<IReadOnlyList<LinkedinPostSummary>>.Success(Elements(root)
            .Select(e => new LinkedinPostSummary(Text(e, "id"), Text(e, "commentary"), Number(e, "createdAt")))
            .ToList());
    }

    public async Task<LinkedinResult<string>> CommentAsync(string actor, string postUrn, string text, string accessToken, string version, CancellationToken cancellationToken)
    {
        var body = new JsonObject
        {
            ["actor"] = actor,
            ["object"] = postUrn,
            ["message"] = new JsonObject { ["text"] = text }
        };
        var (root, error, headers) = await SendWithHeadersAsync(HttpMethod.Post, $"rest/socialActions/{Uri.EscapeDataString(postUrn)}/comments", accessToken, version, body, cancellationToken);
        if (error != null) return LinkedinResult<string>.Fail(error);
        string? id = headers?.TryGetValues("x-restli-id", out var values) == true ? values.FirstOrDefault() : null;
        id ??= TextHelper.NullIfBlank(Text(root, "$URN")) ?? TextHelper.NullIfBlank(Text(root, "id"));
        return LinkedinResult<string>.Success(id ?? "ok");
    }

    /// <summary>«Me gusta» y comentarios de un post (requiere r_organization_social: solo páginas de empresa).</summary>
    public async Task<LinkedinResult<PublicationMetrics>> SocialSummaryAsync(string postUrn, string accessToken, string version, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"rest/socialActions/{Uri.EscapeDataString(postUrn)}", accessToken, version, null, cancellationToken);
        if (error != null) return LinkedinResult<PublicationMetrics>.Fail(error);
        long? likes = root.TryGetProperty("likesSummary", out var l) ? Number(l, "totalLikes") : null;
        long? comments = root.TryGetProperty("commentsSummary", out var c) ? Number(c, "totalFirstLevelComments") : null;
        return LinkedinResult<PublicationMetrics>.Success(new PublicationMetrics(null, likes, comments));
    }
    #endregion

    #region FORMATO
    /// <summary>
    /// Texto en el formato «little text» de LinkedIn: los caracteres reservados van escapados (si no, LinkedIn corta
    /// el texto o lo rechaza) y los #hashtags se convierten en hashtags de verdad.
    /// </summary>
    public static string Commentary(string? text)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;
        var sb = new StringBuilder(text.Length + 16);
        int last = 0;
        foreach (Match m in HashtagRegex().Matches(text))
        {
            sb.Append(Escape(text[last..m.Index]));
            sb.Append(m.Groups[1].Value).Append("{hashtag|\\#|").Append(m.Groups[2].Value).Append('}');
            last = m.Index + m.Length;
        }
        sb.Append(Escape(text[last..]));
        return sb.ToString();
    }

    private static string Escape(string value)
    {
        var sb = new StringBuilder(value.Length);
        foreach (char ch in value)
        {
            if ("\\|{}@[]()<>#*_~".Contains(ch)) sb.Append('\\');
            sb.Append(ch);
        }
        return sb.ToString();
    }

    [GeneratedRegex(@"(^|\s)#([\p{L}\p{N}_]+)")]
    private static partial Regex HashtagRegex();
    #endregion

    #region HTTP
    private async Task<(JsonElement Root, LinkedinError? Error)> SendAsync(HttpMethod method, string path, string accessToken, string version, JsonNode? body, CancellationToken cancellationToken, bool finder = false)
    {
        var (root, error, _) = await SendWithHeadersAsync(method, path, accessToken, version, body, cancellationToken, finder);
        return (root, error);
    }

    private async Task<(JsonElement Root, LinkedinError? Error, HttpResponseHeaders? Headers)> SendWithHeadersAsync(
        HttpMethod method, string path, string accessToken, string version, JsonNode? body, CancellationToken cancellationToken, bool finder = false)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.Linkedin);
        using var request = new HttpRequestMessage(method, Api + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.Add("X-Restli-Protocol-Version", "2.0.0");
        if (path.StartsWith("rest/", StringComparison.Ordinal)) request.Headers.Add("LinkedIn-Version", version);
        if (finder) request.Headers.Add("X-RestLi-Method", "FINDER");
        if (body != null) request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");

        try
        {
            using var response = await client.SendAsync(request, cancellationToken);
            var root = await ReadJsonAsync(response, cancellationToken);
            return response.IsSuccessStatusCode
                ? (root, null, response.Headers)
                : (root, ErrorFrom(response.StatusCode, root, "api"), response.Headers);
        }
        catch (HttpRequestException ex)
        {
            return (default, new LinkedinError(0, "NETWORK", ex.Message, true), null);
        }
    }

    private static LinkedinError ErrorFrom(HttpStatusCode status, JsonElement root, string fallbackCode)
    {
        int code = (int)status;
        string error = Text(root, "code") is { Length: > 0 } c ? c : Text(root, "error") is { Length: > 0 } e ? e : fallbackCode;
        string message = Text(root, "message") is { Length: > 0 } m ? m : Text(root, "error_description");
        bool transient = code is 0 or 408 or 429 or >= 500;
        return new LinkedinError(code, error, message, transient);
    }

    private static IEnumerable<JsonElement> Elements(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty("elements", out var e) && e.ValueKind == JsonValueKind.Array ? e.EnumerateArray() : [];
    #endregion
}

public static class LinkedinResources
{
    public const string Images = "images";
    public const string Videos = "videos";
    public const string Documents = "documents";
}

/// <summary>Token guardado (cifrado) en la conexión. Fechas en segundos Unix.</summary>
public sealed class LinkedinToken
{
    public string AccessToken { get; set; } = string.Empty;
    public long ExpiresAt { get; set; }
    public string? RefreshToken { get; set; }
    public long? RefreshExpiresAt { get; set; }
    public string Scope { get; set; } = string.Empty;
    public bool IsOrganization { get; set; }

    [System.Text.Json.Serialization.JsonIgnore]
    public DateTime ExpiresAtUtc => DateTimeOffset.FromUnixTimeSeconds(ExpiresAt).UtcDateTime;
}

/// <param name="Visibility">PUBLIC o CONNECTIONS.</param>
/// <param name="Content">null = solo texto; si no, article, media o multiImage.</param>
public sealed record LinkedinPost(string Author, string Text, string Visibility, JsonObject? Content);

public sealed record LinkedinMember(string Id, string Name, string? PictureUrl);
public sealed record LinkedinOrganization(string Urn, string Name, string? VanityName);
public sealed record LinkedinUploadTarget(string Urn, string UploadUrl);
public sealed record LinkedinUploadPart(string UploadUrl, long FirstByte, long LastByte);
public sealed record LinkedinVideoUpload(string VideoUrn, string UploadToken, IReadOnlyList<LinkedinUploadPart> Parts);
public sealed record LinkedinPostSummary(string Urn, string Commentary, long CreatedAtMs);

public sealed record LinkedinError(int HttpStatus, string Code, string Message, bool IsTransient);

public sealed record LinkedinResult<T>(T? Data, LinkedinError? Error)
{
    public bool Ok => Error is null;
    public static LinkedinResult<T> Success(T data) => new(data, null);
    public static LinkedinResult<T> Fail(LinkedinError error) => new(default, error);
}
