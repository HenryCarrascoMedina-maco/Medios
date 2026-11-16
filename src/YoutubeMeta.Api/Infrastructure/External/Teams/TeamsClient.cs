using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.WebUtilities;
using static YoutubeMeta.Api.Infrastructure.External.JsonFields;

namespace YoutubeMeta.Api.Infrastructure.External.Teams;

/// <summary>
/// Microsoft Entra (OAuth 2.0 v2, inquilino único) y Microsoft Graph para canales de Teams, más el webhook de
/// Workflows. Permisos delegados: el mensaje sale con el nombre de quien conectó y solo donde ya puede escribir.
/// Los HttpClient no registran URLs (el webhook lleva su firma en la propia URL).
/// </summary>
public sealed class TeamsClient(IHttpClientFactory httpClientFactory)
{
    public const string StatePurpose = "teams-account-state";
    /// <summary>Mismo inicio de sesión pidiendo también leer las respuestas (bandeja).</summary>
    public const string InboxStatePurpose = "teams-account-state-inbox";
    public const string Scopes = "offline_access User.Read ChannelMessage.Send Team.ReadBasic.All Channel.ReadBasic.All Files.ReadWrite.All";
    /// <summary>Permiso para leer los mensajes y respuestas de los canales: lo aprueba un administrador de la organización.</summary>
    public const string ReadScope = "ChannelMessage.Read.All";
    public const string InboxScopes = Scopes + " " + ReadScope;

    /// <summary>Al renovar se piden los mismos permisos que se concedieron (con o sin lectura).</summary>
    public static string ScopesFor(string? granted) =>
        granted?.Contains(ReadScope, StringComparison.OrdinalIgnoreCase) == true ? InboxScopes : Scopes;

    private const string Graph = "https://graph.microsoft.com/v1.0/";
    /// <summary>Hasta aquí se sube de una vez; más grande, por sesión (por partes múltiplo de 320 KiB).</summary>
    public const long SimpleUploadMax = 4L * 1024 * 1024;
    public const long ChunkSize = 320L * 1024 * 16; // 5 MiB

    private static string Login(string tenant) => $"https://login.microsoftonline.com/{Uri.EscapeDataString(tenant)}/oauth2/v2.0/";

    public static string BuildAuthorizeUrl(TeamsSettings app, string state, string scopes = Scopes) =>
        QueryHelpers.AddQueryString(Login(app.TenantId) + "authorize", new Dictionary<string, string?>
        {
            ["client_id"] = app.ClientId,
            ["response_type"] = "code",
            ["redirect_uri"] = app.RedirectUri,
            ["response_mode"] = "query",
            ["scope"] = scopes,
            ["state"] = state,
            ["prompt"] = "select_account"
        });

    /// <summary>Enlace que un administrador abre para aprobar la app en toda la organización.</summary>
    public static string AdminConsentUrl(string tenantId, string clientId) =>
        $"https://login.microsoftonline.com/{Uri.EscapeDataString(tenantId)}/adminconsent?client_id={Uri.EscapeDataString(clientId)}";

    #region OAUTH
    public Task<TeamsResult<TeamsToken>> ExchangeCodeAsync(TeamsSettings app, string code, CancellationToken cancellationToken, string scopes = Scopes) =>
        TokenAsync(app, new Dictionary<string, string>
        {
            ["client_id"] = app.ClientId,
            ["client_secret"] = app.ClientSecret,
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = app.RedirectUri,
            ["scope"] = scopes
        }, cancellationToken);

    /// <summary>Microsoft entrega un refresh token nuevo en cada renovación; el anterior sigue valiendo hasta caducar.</summary>
    public Task<TeamsResult<TeamsToken>> RefreshAsync(TeamsSettings app, string refreshToken, CancellationToken cancellationToken, string scopes = Scopes) =>
        TokenAsync(app, new Dictionary<string, string>
        {
            ["client_id"] = app.ClientId,
            ["client_secret"] = app.ClientSecret,
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
            ["scope"] = scopes
        }, cancellationToken);

    private async Task<TeamsResult<TeamsToken>> TokenAsync(TeamsSettings app, Dictionary<string, string> fields, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.Teams);
        using var response = await client.PostAsync(Login(app.TenantId) + "token", new FormUrlEncodedContent(fields), cancellationToken);
        var root = await ReadJsonAsync(response, cancellationToken);
        if (response.IsSuccessStatusCode && root.TryGetProperty("access_token", out var access))
        {
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            return TeamsResult<TeamsToken>.Success(new TeamsToken
            {
                AccessToken = access.GetString() ?? string.Empty,
                RefreshToken = Text(root, "refresh_token"),
                ExpiresAt = now + Number(root, "expires_in"),
                Scope = Text(root, "scope")
            });
        }
        return TeamsResult<TeamsToken>.Fail(new TeamsError((int)response.StatusCode, Text(root, "error") is { Length: > 0 } e ? e : "token",
            Text(root, "error_description"), (int)response.StatusCode >= 500, null));
    }
    #endregion

    #region EQUIPOS Y CANALES
    public async Task<TeamsResult<TeamsUser>> MeAsync(string token, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{Graph}me?$select=id,displayName,mail,userPrincipalName", token, null, cancellationToken);
        if (error != null) return TeamsResult<TeamsUser>.Fail(error);
        string mail = Text(root, "mail");
        return TeamsResult<TeamsUser>.Success(new TeamsUser(Text(root, "id"), Text(root, "displayName"), mail.Length > 0 ? mail : Text(root, "userPrincipalName")));
    }

    /// <summary>Equipos del usuario con sus canales.</summary>
    public async Task<TeamsResult<IReadOnlyList<TeamsTeam>>> TeamsAsync(string token, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{Graph}me/joinedTeams?$select=id,displayName", token, null, cancellationToken);
        if (error != null) return TeamsResult<IReadOnlyList<TeamsTeam>>.Fail(error);

        var teams = new List<TeamsTeam>();
        foreach (var team in Values(root))
        {
            string id = Text(team, "id");
            var (channels, channelError) = await SendAsync(HttpMethod.Get, $"{Graph}teams/{Uri.EscapeDataString(id)}/channels?$select=id,displayName,membershipType", token, null, cancellationToken);
            var list = channelError == null
                ? Values(channels).Select(c => new TeamsChannel(Text(c, "id"), Text(c, "displayName"), Text(c, "membershipType") is { Length: > 0 } m ? m : "standard")).ToList()
                : [];
            teams.Add(new TeamsTeam(id, Text(team, "displayName"), list));
        }
        return TeamsResult<IReadOnlyList<TeamsTeam>>.Success(teams);
    }

    public async Task<TeamsResult<TeamsChannel>> ChannelAsync(string token, string teamId, string channelId, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{ChannelPath(teamId, channelId)}?$select=id,displayName,membershipType", token, null, cancellationToken);
        return error != null ? TeamsResult<TeamsChannel>.Fail(error)
            : TeamsResult<TeamsChannel>.Success(new TeamsChannel(Text(root, "id"), Text(root, "displayName"), Text(root, "membershipType")));
    }
    #endregion

    #region ARCHIVOS DEL CANAL
    /// <summary>Carpeta «Archivos» del canal en SharePoint (drive e id de la carpeta).</summary>
    public async Task<TeamsResult<(string DriveId, string FolderId)>> FilesFolderAsync(string token, string teamId, string channelId, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{ChannelPath(teamId, channelId)}/filesFolder", token, null, cancellationToken);
        if (error != null) return TeamsResult<(string, string)>.Fail(error);
        string drive = root.TryGetProperty("parentReference", out var parent) ? Text(parent, "driveId") : string.Empty;
        return TeamsResult<(string, string)>.Success((drive, Text(root, "id")));
    }

    /// <summary>Sube un archivo a la carpeta (si el nombre existe, Graph lo renombra). Pequeño de una vez; grande por partes.</summary>
    public async Task<TeamsResult<TeamsFile>> UploadAsync(string token, string driveId, string folderId, string filePath, string fileName, string contentType,
        Action<long> progress, CancellationToken cancellationToken)
    {
        long size = new FileInfo(filePath).Length;
        string item = $"{Graph}drives/{Uri.EscapeDataString(driveId)}/items/{Uri.EscapeDataString(folderId)}:/{Uri.EscapeDataString(fileName)}:";

        if (size <= SimpleUploadMax)
        {
            using var client = httpClientFactory.CreateClient(HttpClients.TeamsUpload);
            using var request = new HttpRequestMessage(HttpMethod.Put, $"{item}/content?@microsoft.graph.conflictBehavior=rename");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Content = new FileSliceContent(filePath, 0, size, progress, contentType);
            using var response = await client.SendAsync(request, cancellationToken);
            var root = await ReadJsonAsync(response, cancellationToken);
            return response.IsSuccessStatusCode ? TeamsResult<TeamsFile>.Success(ReadFile(root)) : TeamsResult<TeamsFile>.Fail(ErrorFrom(response, root));
        }

        var body = new JsonObject { ["item"] = new JsonObject { ["@microsoft.graph.conflictBehavior"] = "rename" } };
        var (session, error) = await SendAsync(HttpMethod.Post, $"{item}/createUploadSession", token, body, cancellationToken);
        if (error != null) return TeamsResult<TeamsFile>.Fail(error);
        string uploadUrl = Text(session, "uploadUrl");

        using var upload = httpClientFactory.CreateClient(HttpClients.TeamsUpload);
        for (long start = 0; start < size; start += ChunkSize)
        {
            long length = Math.Min(ChunkSize, size - start);
            long offset = start;
            // La URL de la sesión ya va firmada: no lleva Authorization.
            using var content = new FileSliceContent(filePath, start, length, sent => progress(offset + sent), contentType);
            content.Headers.ContentRange = new ContentRangeHeaderValue(start, start + length - 1, size);
            using var response = await upload.PutAsync(uploadUrl, content, cancellationToken);
            var root = await ReadJsonAsync(response, cancellationToken);
            if (!response.IsSuccessStatusCode) return TeamsResult<TeamsFile>.Fail(ErrorFrom(response, root));
            if (response.StatusCode is HttpStatusCode.OK or HttpStatusCode.Created) return TeamsResult<TeamsFile>.Success(ReadFile(root));
        }
        return TeamsResult<TeamsFile>.Fail(new TeamsError(0, "upload", "Microsoft no confirmó el final de la subida.", true, null));
    }

    private static TeamsFile ReadFile(JsonElement root)
    {
        // El eTag es «"{GUID},n"»: el GUID es el id del adjunto que pide el mensaje.
        string etag = Text(root, "eTag");
        int open = etag.IndexOf('{'), close = etag.IndexOf('}');
        string attachmentId = open >= 0 && close > open ? etag[(open + 1)..close] : Guid.NewGuid().ToString();
        return new TeamsFile(Text(root, "id"), Text(root, "name"), Text(root, "webUrl"), attachmentId);
    }
    #endregion

    #region MENSAJES
    public async Task<TeamsResult<(string Id, string? WebUrl)>> PostMessageAsync(string token, string teamId, string channelId, JsonObject message, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Post, $"{ChannelPath(teamId, channelId)}/messages", token, message, cancellationToken);
        return error != null ? TeamsResult<(string, string?)>.Fail(error)
            : TeamsResult<(string, string?)>.Success((Text(root, "id"), Text(root, "webUrl") is { Length: > 0 } url ? url : null));
    }

    public async Task<TeamsResult<string>> ReplyAsync(string token, string teamId, string channelId, string messageId, string html, CancellationToken cancellationToken)
    {
        var body = new JsonObject { ["body"] = new JsonObject { ["contentType"] = "html", ["content"] = html } };
        var (root, error) = await SendAsync(HttpMethod.Post, $"{ChannelPath(teamId, channelId)}/messages/{Uri.EscapeDataString(messageId)}/replies", token, body, cancellationToken);
        return error != null ? TeamsResult<string>.Fail(error) : TeamsResult<string>.Success(Text(root, "id"));
    }

    /// <summary>Respuestas al hilo de un mensaje del canal (bandeja). Pide <see cref="ReadScope"/>.</summary>
    public async Task<TeamsResult<IReadOnlyList<JsonElement>>> RepliesAsync(string token, string teamId, string channelId, string messageId, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{ChannelPath(teamId, channelId)}/messages/{Uri.EscapeDataString(messageId)}/replies?$top=50", token, null, cancellationToken);
        return error != null ? TeamsResult<IReadOnlyList<JsonElement>>.Fail(error) : TeamsResult<IReadOnlyList<JsonElement>>.Success(Values(root).ToList());
    }

    /// <summary>Webhook de Workflows: tarjeta adaptable. Responde 202 sin id (no se puede comprobar después).</summary>
    public async Task<TeamsResult<bool>> PostWebhookAsync(string webhookUrl, JsonObject payload, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.Teams);
        try
        {
            using var response = await client.PostAsync(webhookUrl, new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json"), cancellationToken);
            if (response.IsSuccessStatusCode) return TeamsResult<bool>.Success(true);
            var root = await ReadJsonAsync(response, cancellationToken);
            return TeamsResult<bool>.Fail(ErrorFrom(response, root));
        }
        catch (HttpRequestException ex)
        {
            return TeamsResult<bool>.Fail(new TeamsError(0, "NETWORK", ex.Message, true, null));
        }
    }
    #endregion

    #region HTTP
    private static string ChannelPath(string teamId, string channelId) =>
        $"{Graph}teams/{Uri.EscapeDataString(teamId)}/channels/{Uri.EscapeDataString(channelId)}";

    private async Task<(JsonElement Root, TeamsError? Error)> SendAsync(HttpMethod method, string url, string token, JsonNode? body, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.Teams);
        using var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body != null) request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        try
        {
            using var response = await client.SendAsync(request, cancellationToken);
            var root = await ReadJsonAsync(response, cancellationToken);
            return response.IsSuccessStatusCode ? (root, null) : (root, ErrorFrom(response, root));
        }
        catch (HttpRequestException ex)
        {
            return (default, new TeamsError(0, "NETWORK", ex.Message, true, null));
        }
    }

    private static TeamsError ErrorFrom(HttpResponseMessage response, JsonElement root)
    {
        int status = (int)response.StatusCode;
        var error = root.ValueKind == JsonValueKind.Object && root.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.Object ? e : default;
        string code = error.ValueKind == JsonValueKind.Object ? Text(error, "code") : $"http_{status}";
        string message = error.ValueKind == JsonValueKind.Object ? Text(error, "message") : $"Microsoft respondió HTTP {status}.";
        int? retryAfter = response.Headers.RetryAfter?.Delta is { } delta ? (int)delta.TotalSeconds : null;
        return new TeamsError(status, code, message, status is 0 or 408 or 429 or >= 500, retryAfter);
    }

    private static IEnumerable<JsonElement> Values(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.Array ? v.EnumerateArray() : [];
    #endregion
}

/// <summary>Token guardado (cifrado) en cada canal conectado. Fechas en segundos Unix.</summary>
public sealed class TeamsToken
{
    public string AccessToken { get; set; } = string.Empty;
    public string RefreshToken { get; set; } = string.Empty;
    public long ExpiresAt { get; set; }
    public string Scope { get; set; } = string.Empty;
}

public sealed record TeamsUser(string Id, string Name, string Email);
public sealed record TeamsChannel(string Id, string Name, string MembershipType);
public sealed record TeamsTeam(string Id, string Name, IReadOnlyList<TeamsChannel> Channels);
public sealed record TeamsFile(string Id, string Name, string WebUrl, string AttachmentId);

public sealed record TeamsError(int HttpStatus, string Code, string Message, bool IsTransient, int? RetryAfterSeconds);

public sealed record TeamsResult<T>(T? Data, TeamsError? Error)
{
    public bool Ok => Error is null;
    public static TeamsResult<T> Success(T data) => new(data, null);
    public static TeamsResult<T> Fail(TeamsError error) => new(default, error);
}
