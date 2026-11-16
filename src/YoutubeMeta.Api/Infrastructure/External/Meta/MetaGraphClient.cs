using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace YoutubeMeta.Api.Infrastructure.External.Meta;

/// <summary>
/// Graph API con HttpClient nombrados sin loggers. El token va siempre en Authorization, nunca en la URL:
/// en Sinsatools se filtró un token porque el log del HttpClient escribía la URL completa.
/// Sirve a Facebook (Páginas) y a Instagram (cuentas profesionales vinculadas a una Página).
/// </summary>
public sealed class MetaGraphClient(IHttpClientFactory httpClientFactory, IOptions<MetaSettings> settings)
{
    private const string AccountFields = "id,name,category,access_token,tasks,picture%7Burl%7D,instagram_business_account%7Bid,username,name,profile_picture_url%7D";

    private readonly string _graph = $"https://graph.facebook.com/{settings.Value.GraphVersion}/";
    private readonly string _graphVideo = $"https://graph-video.facebook.com/{settings.Value.GraphVersion}/";

    public string GraphVersion => settings.Value.GraphVersion;

    /// <summary>Páginas del token del usuario del sistema, cada una con su cuenta de Instagram si la tiene.</summary>
    public async Task<MetaResult<IReadOnlyList<MetaPage>>> PagesAsync(string userToken, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{_graph}me/accounts?fields={AccountFields}&limit=100", userToken, null, cancellationToken);
        if (error != null) return MetaResult<IReadOnlyList<MetaPage>>.Fail(error);

        return MetaResult<IReadOnlyList<MetaPage>>.Success(DataItems(root).Select(ReadPage).ToList());
    }

    public async Task<MetaResult<MetaPage>> PageAsync(string pageId, string pageToken, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{_graph}{Uri.EscapeDataString(pageId)}?fields=id,name,category,picture%7Burl%7D", pageToken, null, cancellationToken);
        return error != null ? MetaResult<MetaPage>.Fail(error) : MetaResult<MetaPage>.Success(ReadPage(root));
    }

    /// <summary>
    /// debug_token exige el token a revisar en la query (input_token); el de acceso va en la cabecera.
    /// Se usa solo al conectar, y este HttpClient no registra URLs.
    /// </summary>
    public async Task<MetaResult<MetaTokenInfo>> DebugTokenAsync(string inputToken, string accessToken, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{_graph}debug_token?input_token={Uri.EscapeDataString(inputToken)}", accessToken, null, cancellationToken);
        if (error != null) return MetaResult<MetaTokenInfo>.Fail(error);

        var data = root.GetProperty("data");
        long expiresAt = data.TryGetProperty("expires_at", out var exp) && exp.TryGetInt64(out long e) ? e : 0;
        string[] scopes = data.TryGetProperty("scopes", out var sc) && sc.ValueKind == JsonValueKind.Array
            ? sc.EnumerateArray().Select(x => x.GetString() ?? string.Empty).Where(x => x.Length > 0).ToArray()
            : [];
        bool isValid = data.TryGetProperty("is_valid", out var valid) && valid.GetBoolean();

        // granular_scopes: a qué objetos da acceso cada permiso (WhatsApp: ids de las cuentas de WhatsApp Business).
        var targets = new Dictionary<string, string[]>();
        if (data.TryGetProperty("granular_scopes", out var granular) && granular.ValueKind == JsonValueKind.Array)
            foreach (var item in granular.EnumerateArray())
                if (item.TryGetProperty("scope", out var scope) && item.TryGetProperty("target_ids", out var ids) && ids.ValueKind == JsonValueKind.Array)
                    targets[scope.GetString() ?? string.Empty] = ids.EnumerateArray().Select(x => x.GetString() ?? string.Empty).Where(x => x.Length > 0).ToArray();

        return MetaResult<MetaTokenInfo>.Success(new MetaTokenInfo(isValid, expiresAt > 0 ? DateTimeOffset.FromUnixTimeSeconds(expiresAt).UtcDateTime : null, scopes)
        {
            TargetIds = targets
        });
    }

    #region FACEBOOK: SUBIDA POR FASES (POST /{page-id}/videos)
    public async Task<MetaResult<MetaUploadSession>> StartUploadAsync(string pageId, string pageToken, long fileSize, CancellationToken cancellationToken)
    {
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["upload_phase"] = "start",
            ["file_size"] = fileSize.ToString()
        });
        var (root, error) = await SendAsync(HttpMethod.Post, $"{_graphVideo}{Uri.EscapeDataString(pageId)}/videos", pageToken, form, cancellationToken);
        if (error != null) return MetaResult<MetaUploadSession>.Fail(error);

        return MetaResult<MetaUploadSession>.Success(new MetaUploadSession(
            ReadString(root, "upload_session_id"),
            ReadString(root, "video_id"),
            ReadLong(root, "start_offset"),
            ReadLong(root, "end_offset")));
    }

    public async Task<MetaResult<(long Start, long End)>> TransferAsync(string pageId, string pageToken, string sessionId, string filePath, long start, long end, CancellationToken cancellationToken)
    {
        using var form = new MultipartFormDataContent
        {
            { new StringContent("transfer"), "upload_phase" },
            { new StringContent(sessionId), "upload_session_id" },
            { new StringContent(start.ToString()), "start_offset" },
            { new FileSliceContent(filePath, start, end - start), "video_file_chunk", "chunk" }
        };
        var (root, error) = await SendAsync(HttpMethod.Post, $"{_graphVideo}{Uri.EscapeDataString(pageId)}/videos", pageToken, form, cancellationToken);
        return error != null
            ? MetaResult<(long, long)>.Fail(error)
            : MetaResult<(long, long)>.Success((ReadLong(root, "start_offset"), ReadLong(root, "end_offset")));
    }

    public async Task<MetaResult<bool>> FinishUploadAsync(string pageId, string pageToken, string sessionId, string title, string? description, DateTimeOffset? publishAt, CancellationToken cancellationToken)
    {
        var fields = new Dictionary<string, string>
        {
            ["upload_phase"] = "finish",
            ["upload_session_id"] = sessionId,
            ["title"] = title,
            ["description"] = description ?? string.Empty,
            ["published"] = publishAt is null ? "true" : "false"
        };
        if (publishAt is { } at) fields["scheduled_publish_time"] = at.ToUnixTimeSeconds().ToString();

        var (root, error) = await SendAsync(HttpMethod.Post, $"{_graphVideo}{Uri.EscapeDataString(pageId)}/videos", pageToken, new FormUrlEncodedContent(fields), cancellationToken);
        if (error != null) return MetaResult<bool>.Fail(error);
        return MetaResult<bool>.Success(Succeeded(root));
    }

    public async Task<MetaResult<MetaVideoStatus>> VideoStatusAsync(string videoId, string pageToken, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{_graph}{Uri.EscapeDataString(videoId)}?fields=status,permalink_url", pageToken, null, cancellationToken);
        if (error != null) return MetaResult<MetaVideoStatus>.Fail(error);

        var status = root.TryGetProperty("status", out var s) ? s : default;
        string? Phase(string name, string field) =>
            status.ValueKind == JsonValueKind.Object && status.TryGetProperty(name, out var phase) && phase.TryGetProperty(field, out var value) ? value.GetString() : null;
        string? PhaseError(string name) =>
            status.ValueKind == JsonValueKind.Object && status.TryGetProperty(name, out var phase) && phase.TryGetProperty("errors", out var errors)
                && errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0 && errors[0].TryGetProperty("message", out var m)
                ? m.GetString() : null;

        string? permalink = root.TryGetProperty("permalink_url", out var p) ? p.GetString() : null;
        if (permalink != null && permalink.StartsWith('/')) permalink = $"https://www.facebook.com{permalink}";

        return MetaResult<MetaVideoStatus>.Success(new MetaVideoStatus(
            status.ValueKind == JsonValueKind.Object && status.TryGetProperty("video_status", out var vs) ? vs.GetString() : null,
            Phase("processing_phase", "status"),
            Phase("publishing_phase", "status"),
            Phase("publishing_phase", "publish_status"),
            PhaseError("uploading_phase") ?? PhaseError("processing_phase") ?? PhaseError("publishing_phase"),
            permalink));
    }
    #endregion

    #region INSTAGRAM: REELS (contenedor → subida reanudable → media_publish)
    public async Task<MetaResult<MetaInstagramAccount>> InstagramAccountAsync(string igUserId, string token, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{_graph}{Uri.EscapeDataString(igUserId)}?fields=id,username,name,profile_picture_url", token, null, cancellationToken);
        return error != null ? MetaResult<MetaInstagramAccount>.Fail(error) : MetaResult<MetaInstagramAccount>.Success(ReadInstagram(root));
    }

    /// <summary>Contenedor REELS con upload_type=resumable: devuelve su id y la URI de rupload donde se sube el archivo.</summary>
    public async Task<MetaResult<(string ContainerId, string UploadUri)>> CreateReelContainerAsync(string igUserId, string token, string? caption, bool shareToFeed, CancellationToken cancellationToken)
    {
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["media_type"] = "REELS",
            ["upload_type"] = "resumable",
            ["caption"] = caption ?? string.Empty,
            ["share_to_feed"] = shareToFeed ? "true" : "false"
        });
        var (root, error) = await SendAsync(HttpMethod.Post, $"{_graph}{Uri.EscapeDataString(igUserId)}/media", token, form, cancellationToken);
        if (error != null) return MetaResult<(string, string)>.Fail(error);
        return MetaResult<(string, string)>.Success((ReadString(root, "id"), ReadString(root, "uri")));
    }

    /// <summary>
    /// Envía el archivo desde <paramref name="offset"/> (para reanudar tras un corte). Las cabeceras offset y
    /// file_size son las que pide rupload; el token va como «OAuth», no como Bearer.
    /// </summary>
    public async Task<MetaResult<bool>> UploadReelAsync(string uploadUri, string token, string filePath, long offset, long fileSize, Action<long> progress, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.MetaUpload);
        using var request = new HttpRequestMessage(HttpMethod.Post, uploadUri)
        {
            Content = new FileSliceContent(filePath, offset, fileSize - offset, sent => progress(offset + sent))
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("OAuth", token);
        request.Headers.Add("offset", offset.ToString());
        request.Headers.Add("file_size", fileSize.ToString());

        using var response = await client.SendAsync(request, cancellationToken);
        string body = await response.Content.ReadAsStringAsync(cancellationToken);
        var (root, error) = Parse(body, response);
        if (error != null) return MetaResult<bool>.Fail(error);

        if (Succeeded(root)) return MetaResult<bool>.Success(true);

        // rupload informa los fallos en debug_info { retriable, type, message }.
        bool retriable = root.TryGetProperty("debug_info", out var debug) && debug.TryGetProperty("retriable", out var r) && r.ValueKind == JsonValueKind.True;
        string message = debug.ValueKind == JsonValueKind.Object && debug.TryGetProperty("message", out var m) ? m.GetString() ?? "Instagram no aceptó el archivo." : "Instagram no aceptó el archivo.";
        return MetaResult<bool>.Fail(new MetaError((int)response.StatusCode, null, message, retriable, null, null));
    }

    public async Task<MetaResult<MetaContainerStatus>> ContainerStatusAsync(string containerId, string token, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{_graph}{Uri.EscapeDataString(containerId)}?fields=id,status,status_code,video_status", token, null, cancellationToken);
        if (error != null) return MetaResult<MetaContainerStatus>.Fail(error);

        long transferred = root.TryGetProperty("video_status", out var vs) && vs.TryGetProperty("uploading_phase", out var up)
            ? ReadLong(up, "bytes_transferred") : 0;
        return MetaResult<MetaContainerStatus>.Success(new MetaContainerStatus(
            ReadString(root, "status_code"),
            root.TryGetProperty("status", out var st) ? st.GetString() : null,
            transferred));
    }

    public async Task<MetaResult<string>> MediaPublishAsync(string igUserId, string token, string containerId, CancellationToken cancellationToken)
    {
        var form = new FormUrlEncodedContent(new Dictionary<string, string> { ["creation_id"] = containerId });
        var (root, error) = await SendAsync(HttpMethod.Post, $"{_graph}{Uri.EscapeDataString(igUserId)}/media_publish", token, form, cancellationToken);
        return error != null ? MetaResult<string>.Fail(error) : MetaResult<string>.Success(ReadString(root, "id"));
    }

    public async Task<string?> MediaPermalinkAsync(string mediaId, string token, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{_graph}{Uri.EscapeDataString(mediaId)}?fields=permalink", token, null, cancellationToken);
        return error == null && root.TryGetProperty("permalink", out var p) ? p.GetString() : null;
    }

    /// <summary>Publicaciones hechas por API en las últimas 24 h y el máximo de la cuenta (Meta lo cambia: se lee siempre).</summary>
    public async Task<MetaResult<(int Used, int Total)>> PublishingLimitAsync(string igUserId, string token, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{_graph}{Uri.EscapeDataString(igUserId)}/content_publishing_limit?fields=config,quota_usage", token, null, cancellationToken);
        if (error != null) return MetaResult<(int, int)>.Fail(error);

        var item = root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array && data.GetArrayLength() > 0 ? data[0] : default;
        if (item.ValueKind != JsonValueKind.Object) return MetaResult<(int, int)>.Success((0, int.MaxValue));

        int used = (int)ReadLong(item, "quota_usage");
        int total = item.TryGetProperty("config", out var config) ? (int)ReadLong(config, "quota_total") : 0;
        return MetaResult<(int, int)>.Success((used, total > 0 ? total : int.MaxValue));
    }
    #endregion

    #region FACEBOOK: TEXTO, ENLACE Y FOTOS
    /// <summary>
    /// Foto sin publicar (se adjunta después a una publicación del muro). <paramref name="temporary"/> = la
    /// publicación va programada (Meta lo exige para fotos de publicaciones programadas).
    /// </summary>
    public async Task<MetaResult<string>> UploadUnpublishedPhotoAsync(string pageId, string pageToken, string filePath, string contentType, bool temporary, CancellationToken cancellationToken)
    {
        await using var file = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16, FileOptions.Asynchronous);
        var source = new StreamContent(file);
        source.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        using var form = new MultipartFormDataContent
        {
            { new StringContent("false"), "published" },
            { new StringContent(temporary ? "true" : "false"), "temporary" },
            { source, "source", Path.GetFileName(filePath) }
        };
        var (root, error) = await SendAsync(HttpMethod.Post, $"{_graph}{Uri.EscapeDataString(pageId)}/photos", pageToken, form, cancellationToken);
        return error != null ? MetaResult<string>.Fail(error) : MetaResult<string>.Success(ReadString(root, "id"));
    }

    /// <summary>Publicación en el muro de la Página: texto, enlace o fotos ya subidas. Devuelve el id del post.</summary>
    public async Task<MetaResult<string>> FeedPostAsync(string pageId, string pageToken, string message, string? link, IReadOnlyList<string> photoIds, DateTimeOffset? publishAt, CancellationToken cancellationToken)
    {
        var fields = new Dictionary<string, string> { ["message"] = message };
        if (!string.IsNullOrWhiteSpace(link)) fields["link"] = link;
        for (int i = 0; i < photoIds.Count; i++) fields[$"attached_media[{i}]"] = $"{{\"media_fbid\":\"{photoIds[i]}\"}}";
        if (publishAt is { } at)
        {
            fields["published"] = "false";
            fields["scheduled_publish_time"] = at.ToUnixTimeSeconds().ToString();
        }
        var (root, error) = await SendAsync(HttpMethod.Post, $"{_graph}{Uri.EscapeDataString(pageId)}/feed", pageToken, new FormUrlEncodedContent(fields), cancellationToken);
        return error != null ? MetaResult<string>.Fail(error) : MetaResult<string>.Success(ReadString(root, "id"));
    }

    /// <summary>Últimas publicaciones del muro (para comprobar si un envío cortado llegó).</summary>
    public async Task<MetaResult<IReadOnlyList<(string Id, string Message, DateTimeOffset CreatedAt)>>> RecentFeedAsync(string pageId, string pageToken, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{_graph}{Uri.EscapeDataString(pageId)}/feed?fields=id,message,created_time&limit=10", pageToken, null, cancellationToken);
        if (error != null) return MetaResult<IReadOnlyList<(string, string, DateTimeOffset)>>.Fail(error);
        var list = DataItems(root).Select(e => (ReadString(e, "id"), ReadString(e, "message"),
            DateTimeOffset.TryParse(ReadString(e, "created_time"), out var at) ? at : DateTimeOffset.MinValue)).ToList();
        return MetaResult<IReadOnlyList<(string, string, DateTimeOffset)>>.Success(list);
    }

    /// <summary>
    /// Comentario de la propia cuenta en un post de Facebook o un media de Instagram (edge «comments»), o respuesta a un
    /// comentario de Instagram (edge «replies»). Devuelve su id.
    /// </summary>
    public async Task<MetaResult<string>> CommentAsync(string objectId, string token, string message, CancellationToken cancellationToken, string edge = "comments")
    {
        var form = new FormUrlEncodedContent(new Dictionary<string, string> { ["message"] = message });
        var (root, error) = await SendAsync(HttpMethod.Post, $"{_graph}{Uri.EscapeDataString(objectId)}/{edge}", token, form, cancellationToken);
        return error != null ? MetaResult<string>.Fail(error) : MetaResult<string>.Success(ReadString(root, "id"));
    }
    #endregion

    #region INSTAGRAM: IMAGEN Y CARRUSEL (Meta descarga la imagen desde una URL pública)
    /// <param name="carouselItem">true = elemento de un carrusel (sin texto); false = imagen suelta con su texto.</param>
    public async Task<MetaResult<string>> CreateImageContainerAsync(string igUserId, string token, string imageUrl, string? caption, bool carouselItem, string? altText, CancellationToken cancellationToken)
    {
        var fields = new Dictionary<string, string> { ["image_url"] = imageUrl };
        if (carouselItem) fields["is_carousel_item"] = "true";
        else fields["caption"] = caption ?? string.Empty;
        if (!string.IsNullOrWhiteSpace(altText)) fields["alt_text"] = altText;
        var (root, error) = await SendAsync(HttpMethod.Post, $"{_graph}{Uri.EscapeDataString(igUserId)}/media", token, new FormUrlEncodedContent(fields), cancellationToken);
        return error != null ? MetaResult<string>.Fail(error) : MetaResult<string>.Success(ReadString(root, "id"));
    }

    public async Task<MetaResult<string>> CreateCarouselContainerAsync(string igUserId, string token, IReadOnlyList<string> children, string? caption, CancellationToken cancellationToken)
    {
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["media_type"] = "CAROUSEL",
            ["children"] = string.Join(',', children),
            ["caption"] = caption ?? string.Empty
        });
        var (root, error) = await SendAsync(HttpMethod.Post, $"{_graph}{Uri.EscapeDataString(igUserId)}/media", token, form, cancellationToken);
        return error != null ? MetaResult<string>.Fail(error) : MetaResult<string>.Success(ReadString(root, "id"));
    }
    #endregion

    #region MÉTRICAS
    /// <summary>«Me gusta» y comentarios de un video de Página (permiso pages_read_engagement).</summary>
    public async Task<MetaResult<PublicationMetrics>> VideoEngagementAsync(string videoId, string pageToken, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get,
            $"{_graph}{Uri.EscapeDataString(videoId)}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0)", pageToken, null, cancellationToken);
        if (error != null) return MetaResult<PublicationMetrics>.Fail(error);

        static long? Total(JsonElement element, string name) =>
            element.TryGetProperty(name, out var edge) && edge.TryGetProperty("summary", out var summary) ? ReadLong(summary, "total_count") : null;
        return MetaResult<PublicationMetrics>.Success(new PublicationMetrics(null, Total(root, "likes"), Total(root, "comments")));
    }

    /// <summary>«Me gusta» y comentarios de un Reel (campos del objeto media, permiso instagram_basic).</summary>
    public async Task<MetaResult<PublicationMetrics>> MediaEngagementAsync(string mediaId, string token, CancellationToken cancellationToken)
    {
        var (root, error) = await SendAsync(HttpMethod.Get, $"{_graph}{Uri.EscapeDataString(mediaId)}?fields=like_count,comments_count", token, null, cancellationToken);
        if (error != null) return MetaResult<PublicationMetrics>.Fail(error);
        return MetaResult<PublicationMetrics>.Success(new PublicationMetrics(null,
            root.TryGetProperty("like_count", out _) ? ReadLong(root, "like_count") : null,
            root.TryGetProperty("comments_count", out _) ? ReadLong(root, "comments_count") : null));
    }
    #endregion

    #region BANDEJA (Messenger, Instagram y suscripción a los webhooks)
    /// <summary>
    /// Mensaje privado desde una Página (Messenger) o desde la cuenta de Instagram vinculada a ella, siempre con el token
    /// de la Página. <paramref name="message"/> = { text } o { attachment }. Devuelve el message_id.
    /// </summary>
    public async Task<MetaResult<string>> SendMessageAsync(string pageId, string pageToken, JsonObject recipient, JsonObject message, string? tag,
        CancellationToken cancellationToken)
    {
        var body = new JsonObject
        {
            ["recipient"] = recipient,
            ["messaging_type"] = tag is null ? "RESPONSE" : "MESSAGE_TAG",
            ["message"] = message
        };
        if (tag is not null) body["tag"] = tag;
        var (root, error) = await CallAsync(HttpMethod.Post, $"{Uri.EscapeDataString(pageId)}/messages", pageToken, Json(body), cancellationToken);
        return error != null ? MetaResult<string>.Fail(error) : MetaResult<string>.Success(ReadString(root, "message_id"));
    }

    /// <summary>Nombre y foto de quien escribe (Messenger: PSID; Instagram: IGSID). Null si Meta no lo da.</summary>
    public async Task<(string? Name, string? Handle, string? PictureUrl)?> ProfileAsync(string userId, string token, bool instagram, CancellationToken cancellationToken)
    {
        string fields = instagram ? "name,username,profile_pic" : "first_name,last_name,profile_pic";
        var (root, error) = await CallAsync(HttpMethod.Get, $"{Uri.EscapeDataString(userId)}?fields={fields}", token, null, cancellationToken);
        if (error != null) return null;
        string? Text(string name) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        string? name = instagram ? Text("name") : string.Join(' ', new[] { Text("first_name"), Text("last_name") }.Where(x => !string.IsNullOrEmpty(x)));
        string? handle = instagram && Text("username") is { } u ? $"@{u}" : null;
        return (string.IsNullOrWhiteSpace(name) ? handle : name, handle, Text("profile_pic"));
    }

    /// <summary>Suscribe la app a los avisos de un objeto: una Página (con sus campos) o una cuenta de WhatsApp Business.</summary>
    public async Task<MetaResult<bool>> SubscribeAppAsync(string objectId, string token, string? fields, CancellationToken cancellationToken)
    {
        var form = new FormUrlEncodedContent(fields is null ? [] : new Dictionary<string, string> { ["subscribed_fields"] = fields });
        var (root, error) = await CallAsync(HttpMethod.Post, $"{Uri.EscapeDataString(objectId)}/subscribed_apps", token, form, cancellationToken);
        return error != null ? MetaResult<bool>.Fail(error) : MetaResult<bool>.Success(Succeeded(root));
    }

    /// <summary>Página vinculada a una cuenta de Instagram y su token (los mensajes de Instagram salen por la Página).</summary>
    public async Task<MetaResult<MetaPage>> PageForInstagramAsync(string igUserId, string userToken, CancellationToken cancellationToken)
    {
        var pages = await PagesAsync(userToken, cancellationToken);
        if (!pages.Ok) return MetaResult<MetaPage>.Fail(pages.Error!);
        var page = pages.Data!.FirstOrDefault(p => p.Instagram?.Id == igUserId && p.AccessToken is { Length: > 0 });
        return page is null
            ? MetaResult<MetaPage>.Fail(new MetaError(200, null, "El token no da acceso a la Página vinculada a esta cuenta de Instagram.", false, null, null))
            : MetaResult<MetaPage>.Success(page);
    }
    #endregion

    /// <summary>
    /// Llamada a la Graph API (ruta relativa a la versión, p. ej. «{id}/messages»). Para los clientes que comparten
    /// este (WhatsApp): mismo HttpClient sin loggers, token en la cabecera y errores con el mismo formato.
    /// </summary>
    public Task<(JsonElement Root, MetaError? Error)> CallAsync(HttpMethod method, string path, string token, HttpContent? content, CancellationToken cancellationToken) =>
        SendAsync(method, _graph + path, token, content, cancellationToken);

    public static StringContent Json(JsonNode body) => new(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json");

    private async Task<(JsonElement Root, MetaError? Error)> SendAsync(HttpMethod method, string url, string token, HttpContent? content, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.Meta);
        using var request = new HttpRequestMessage(method, url) { Content = content };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var response = await client.SendAsync(request, cancellationToken);
        return Parse(await response.Content.ReadAsStringAsync(cancellationToken), response);
    }

    private static (JsonElement Root, MetaError? Error) Parse(string body, HttpResponseMessage response)
    {
        JsonElement root;
        try
        {
            root = JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body).RootElement.Clone();
        }
        catch (JsonException)
        {
            return (default, new MetaError((int)response.StatusCode, null, $"Respuesta no válida de Meta (HTTP {(int)response.StatusCode}).", response.StatusCode >= System.Net.HttpStatusCode.InternalServerError, null, null));
        }

        if (root.TryGetProperty("error", out var error))
            return (root, ReadError(error, response));

        return response.IsSuccessStatusCode
            ? (root, null)
            : (root, new MetaError((int)response.StatusCode, null, $"Meta respondió HTTP {(int)response.StatusCode}.", (int)response.StatusCode >= 500, null, null));
    }

    private static MetaError ReadError(JsonElement error, HttpResponseMessage response)
    {
        int code = error.TryGetProperty("code", out var c) && c.TryGetInt32(out int ci) ? ci : (int)response.StatusCode;
        int? subcode = error.TryGetProperty("error_subcode", out var s) && s.TryGetInt32(out int si) ? si : null;
        string message = (error.TryGetProperty("error_user_msg", out var um) ? um.GetString() : null)
            ?? (error.TryGetProperty("message", out var m) ? m.GetString() : null)
            ?? "Error de Meta.";
        bool transient = error.TryGetProperty("is_transient", out var t) && t.ValueKind == JsonValueKind.True;
        JsonElement? data = error.TryGetProperty("error_data", out var d) ? d.Clone() : null;

        return new MetaError(code, subcode, message, transient, data, RegainAccessMinutes(response));
    }

    /// <summary>Con límite de tasa, Meta indica en X-Business-Use-Case-Usage cuándo se recupera el acceso.</summary>
    private static int? RegainAccessMinutes(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("X-Business-Use-Case-Usage", out var values)) return null;
        try
        {
            using var doc = JsonDocument.Parse(values.First());
            int? max = null;
            foreach (var business in doc.RootElement.EnumerateObject())
                foreach (var usage in business.Value.EnumerateArray())
                    if (usage.TryGetProperty("estimated_time_to_regain_access", out var minutes) && minutes.TryGetInt32(out int value))
                        max = Math.Max(max ?? 0, value);
            return max;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static MetaPage ReadPage(JsonElement page) => new(
        ReadString(page, "id"),
        ReadString(page, "name"),
        page.TryGetProperty("category", out var cat) ? cat.GetString() : null,
        page.TryGetProperty("access_token", out var token) ? token.GetString() : null,
        page.TryGetProperty("picture", out var pic) && pic.TryGetProperty("data", out var picData) && picData.TryGetProperty("url", out var url) ? url.GetString() : null,
        page.TryGetProperty("tasks", out var tasks) && tasks.ValueKind == JsonValueKind.Array
            ? tasks.EnumerateArray().Select(x => x.GetString() ?? string.Empty).ToArray()
            : [],
        page.TryGetProperty("instagram_business_account", out var ig) && ig.ValueKind == JsonValueKind.Object ? ReadInstagram(ig) : null);

    private static MetaInstagramAccount ReadInstagram(JsonElement ig) => new(
        ReadString(ig, "id"),
        ReadString(ig, "username"),
        ig.TryGetProperty("name", out var name) ? name.GetString() : null,
        ig.TryGetProperty("profile_picture_url", out var pic) ? pic.GetString() : null);

    private static bool Succeeded(JsonElement root) => root.TryGetProperty("success", out var ok) && ok.ValueKind == JsonValueKind.True;

    /// <summary>Elementos de la lista «data» de una respuesta (vacía si no viene).</summary>
    internal static IEnumerable<JsonElement> DataItems(JsonElement root) =>
        root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array ? data.EnumerateArray() : [];

    private static string ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value)
            ? value.ValueKind == JsonValueKind.String ? value.GetString() ?? string.Empty : value.ToString()
            : string.Empty;

    /// <summary>Meta devuelve algunos números como texto ("1048576").</summary>
    internal static long ReadLong(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value)
        && (value.ValueKind == JsonValueKind.Number ? value.TryGetInt64(out long n) : long.TryParse(value.GetString(), out n))
            ? n : 0;
}

public sealed record MetaError(int Code, int? Subcode, string Message, bool IsTransient, JsonElement? Data, int? RegainAccessMinutes);

public sealed record MetaResult<T>(T? Data, MetaError? Error)
{
    public bool Ok => Error is null;
    public static MetaResult<T> Success(T data) => new(data, null);
    public static MetaResult<T> Fail(MetaError error) => new(default, error);
}

public sealed record MetaPage(string Id, string Name, string? Category, string? AccessToken, string? PictureUrl, string[] Tasks, MetaInstagramAccount? Instagram = null)
{
    public bool CanCreateContent => Tasks.Length == 0 || Tasks.Any(t => t is "CREATE_CONTENT" or "MANAGE");
}

public sealed record MetaInstagramAccount(string Id, string Username, string? Name, string? PictureUrl);

public sealed record MetaTokenInfo(bool IsValid, DateTime? ExpiresAt, string[] Scopes)
{
    /// <summary>Permiso → objetos a los que da acceso (granular_scopes).</summary>
    public IReadOnlyDictionary<string, string[]> TargetIds { get; init; } = new Dictionary<string, string[]>();
}

public sealed record MetaUploadSession(string SessionId, string VideoId, long StartOffset, long EndOffset);

public sealed record MetaVideoStatus(string? VideoStatus, string? ProcessingStatus, string? PublishingStatus, string? PublishStatus, string? ErrorMessage, string? PermalinkUrl)
{
    public bool IsFailed => VideoStatus is "error" or "upload_failed" or "expired";

    /// <summary>Publicado o programado en Facebook.</summary>
    public bool IsPublished => PublishStatus is "published" or "scheduled" || PublishingStatus == "complete";
}

public sealed record MetaContainerStatus(string StatusCode, string? Status, long BytesTransferred);
