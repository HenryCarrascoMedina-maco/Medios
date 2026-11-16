using System.Text.Json;

namespace YoutubeMeta.Api.Infrastructure.External.Telegram;

/// <summary>
/// Bot API de Telegram. El token va en la URL (así lo exige la API): por eso los HttpClient de Telegram
/// se registran sin loggers y aquí nunca se escribe una URL en el log. <c>baseUrl</c> permite usar un
/// servidor Bot API propio (hasta 2 GB por archivo) en lugar de api.telegram.org (50 MB).
/// </summary>
public sealed class TelegramBotClient(IHttpClientFactory httpClientFactory)
{
    public Task<TelegramResult<TelegramUser>> GetMeAsync(string baseUrl, string token, CancellationToken cancellationToken) =>
        CallAsync(baseUrl, token, "getMe", null, ReadUser, cancellationToken);

    /// <summary>chat = @usuario del canal o id numérico (-100…).</summary>
    public Task<TelegramResult<TelegramChat>> GetChatAsync(string baseUrl, string token, string chat, CancellationToken cancellationToken) =>
        CallAsync(baseUrl, token, "getChat", new Dictionary<string, string> { ["chat_id"] = chat }, ReadChat, cancellationToken);

    public Task<TelegramResult<TelegramMember>> GetChatMemberAsync(string baseUrl, string token, string chatId, long userId, CancellationToken cancellationToken) =>
        CallAsync(baseUrl, token, "getChatMember", new Dictionary<string, string> { ["chat_id"] = chatId, ["user_id"] = userId.ToString() }, ReadMember, cancellationToken);

    /// <summary>
    /// Canales y grupos donde añadieron al bot en las últimas 24 h (getUpdates sin confirmar nada: las
    /// actualizaciones siguen ahí para la próxima vez). No funciona si el bot tiene un webhook.
    /// </summary>
    public Task<TelegramResult<IReadOnlyList<TelegramChat>>> RecentChatsAsync(string baseUrl, string token, CancellationToken cancellationToken) =>
        CallAsync(baseUrl, token, "getUpdates", new Dictionary<string, string>
        {
            ["allowed_updates"] = "[\"my_chat_member\",\"channel_post\",\"message\"]",
            ["limit"] = "100",
            ["timeout"] = "0"
        }, ReadChatsFromUpdates, cancellationToken);

    public async Task<TelegramResult<TelegramMessage>> SendVideoAsync(string baseUrl, string token, TelegramVideo video, Action<long> progress, CancellationToken cancellationToken)
    {
        using var form = new MultipartFormDataContent
        {
            { new StringContent(video.ChatId), "chat_id" },
            { new StringContent(video.Caption), "caption" },
            { new StringContent("true"), "supports_streaming" },
            { new StringContent(video.DisableNotification ? "true" : "false"), "disable_notification" },
            { new StringContent(video.ProtectContent ? "true" : "false"), "protect_content" }
        };
        if (video.Width is { } w) form.Add(new StringContent(w.ToString()), "width");
        if (video.Height is { } h) form.Add(new StringContent(h.ToString()), "height");
        if (video.DurationSec is { } d) form.Add(new StringContent(((int)Math.Round(d)).ToString()), "duration");
        form.Add(new FileSliceContent(video.FilePath, 0, new FileInfo(video.FilePath).Length, progress, video.ContentType), "video", video.FileName);

        using var client = httpClientFactory.CreateClient(HttpClients.TelegramUpload);
        using var response = await client.PostAsync(MethodUrl(baseUrl, token, "sendVideo"), form, cancellationToken);
        return Parse(await response.Content.ReadAsStringAsync(cancellationToken), (int)response.StatusCode, ReadMessage);
    }

    /// <summary>Mensaje de texto (los enlaces muestran su vista previa). <paramref name="replyTo"/> cita un mensaje del chat.</summary>
    public Task<TelegramResult<TelegramMessage>> SendMessageAsync(string baseUrl, string token, string chatId, string text, bool disableNotification, bool protectContent,
        CancellationToken cancellationToken, string? replyTo = null)
    {
        var fields = new Dictionary<string, string>
        {
            ["chat_id"] = chatId,
            ["text"] = text,
            ["disable_notification"] = disableNotification ? "true" : "false",
            ["protect_content"] = protectContent ? "true" : "false"
        };
        if (replyTo is not null) fields["reply_parameters"] = $"{{\"message_id\":{replyTo},\"allow_sending_without_reply\":true}}";
        return CallAsync(baseUrl, token, "sendMessage", fields, ReadMessage, cancellationToken);
    }

    #region BANDEJA
    private const string InboxUpdateTypes = "[\"message\",\"my_chat_member\",\"channel_post\"]";

    /// <summary>Clave de los avisos de un bot en Inbox_Events: «bot{credencial}:{update_id}».</summary>
    public static string EventKeyPrefix(int credentialId) => $"bot{credentialId}:";

    /// <summary>
    /// Novedades desde <paramref name="offset"/> (confirma las anteriores). Cada una sale como JSON tal cual para
    /// guardarla en crudo. Falla con 409 si el bot tiene un webhook.
    /// </summary>
    public Task<TelegramResult<IReadOnlyList<(long UpdateId, string Json)>>> UpdatesAsync(string baseUrl, string token, long? offset, CancellationToken cancellationToken)
    {
        var fields = new Dictionary<string, string>
        {
            ["allowed_updates"] = InboxUpdateTypes,
            ["limit"] = "100",
            ["timeout"] = "0"
        };
        if (offset is { } value) fields["offset"] = value.ToString();
        return CallAsync<IReadOnlyList<(long, string)>>(baseUrl, token, "getUpdates", fields,
            updates => updates.EnumerateArray().Select(u => (u.GetProperty("update_id").GetInt64(), u.GetRawText())).ToList(), cancellationToken);
    }

    /// <summary>Telegram enviará cada novedad a <paramref name="url"/> con el secreto en la cabecera.</summary>
    public Task<TelegramResult<bool>> SetWebhookAsync(string baseUrl, string token, string url, string secret, CancellationToken cancellationToken) =>
        CallAsync(baseUrl, token, "setWebhook", new Dictionary<string, string>
        {
            ["url"] = url,
            ["secret_token"] = secret,
            ["allowed_updates"] = InboxUpdateTypes
        }, r => r.ValueKind == JsonValueKind.True, cancellationToken);

    /// <summary>Quita el webhook (sin borrar lo pendiente) para volver a leer con getUpdates.</summary>
    public Task<TelegramResult<bool>> DeleteWebhookAsync(string baseUrl, string token, CancellationToken cancellationToken) =>
        CallAsync(baseUrl, token, "deleteWebhook", null, r => r.ValueKind == JsonValueKind.True, cancellationToken);

    /// <summary>Descarga un archivo recibido (getFile + /file/bot…/ruta). Telegram lo sirve hasta 20 MB.</summary>
    public async Task<Stream?> DownloadAsync(string baseUrl, string token, string fileId, CancellationToken cancellationToken)
    {
        var file = await CallAsync(baseUrl, token, "getFile", new Dictionary<string, string> { ["file_id"] = fileId },
            r => r.TryGetProperty("file_path", out var path) ? path.GetString() : null, cancellationToken);
        if (!file.Ok || file.Data is not { } filePath) return null;

        var client = httpClientFactory.CreateClient(HttpClients.TelegramUpload);
        var response = await client.GetAsync($"{baseUrl.TrimEnd('/')}/file/bot{token}/{filePath}", HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (response.IsSuccessStatusCode) return await response.Content.ReadAsStreamAsync(cancellationToken);
        response.Dispose();
        return null;
    }

    /// <summary>Canales y grupos que aparecen en novedades guardadas (cada una, el JSON de un update).</summary>
    public static IReadOnlyList<TelegramChat> ChatsFromUpdates(IEnumerable<string> updates)
    {
        var list = new List<TelegramChat>();
        foreach (string json in updates)
            try
            {
                using var document = JsonDocument.Parse(json);
                list.AddRange(ChatsOf(document.RootElement));
            }
            catch (JsonException)
            {
                // Un aviso dañado no impide ver los demás.
            }
        return list.DistinctBy(c => c.Id).ToList();
    }
    #endregion

    /// <summary>
    /// Una foto (sendPhoto), un documento (sendDocument) o un álbum de 2 a 10 fotos (sendMediaGroup, el texto va en
    /// la primera). Devuelve el primer mensaje.
    /// </summary>
    public async Task<TelegramResult<TelegramMessage>> SendFilesAsync(string baseUrl, string token, TelegramFiles files, Action<long> progress, CancellationToken cancellationToken)
    {
        using var form = new MultipartFormDataContent
        {
            { new StringContent(files.ChatId), "chat_id" },
            { new StringContent(files.DisableNotification ? "true" : "false"), "disable_notification" },
            { new StringContent(files.ProtectContent ? "true" : "false"), "protect_content" }
        };

        long total = files.Items.Sum(i => new FileInfo(i.FilePath).Length), before = 0;
        string method;
        if (files.Items.Count == 1)
        {
            var item = files.Items[0];
            bool document = files.AsDocument;
            method = document ? "sendDocument" : "sendPhoto";
            form.Add(new StringContent(files.Caption), "caption");
            form.Add(new FileSliceContent(item.FilePath, 0, new FileInfo(item.FilePath).Length, progress, item.ContentType), document ? "document" : "photo", item.FileName);
        }
        else
        {
            method = "sendMediaGroup";
            var media = new System.Text.Json.Nodes.JsonArray();
            for (int i = 0; i < files.Items.Count; i++)
            {
                var item = files.Items[i];
                var entry = new System.Text.Json.Nodes.JsonObject { ["type"] = "photo", ["media"] = $"attach://f{i}" };
                if (i == 0) entry["caption"] = files.Caption;
                media.Add(entry);
                long offset = before, length = new FileInfo(item.FilePath).Length;
                form.Add(new FileSliceContent(item.FilePath, 0, length, sent => progress(offset + sent), item.ContentType), $"f{i}", item.FileName);
                before += length;
            }
            form.Add(new StringContent(media.ToJsonString()), "media");
        }

        using var client = httpClientFactory.CreateClient(HttpClients.TelegramUpload);
        using var response = await client.PostAsync(MethodUrl(baseUrl, token, method), form, cancellationToken);
        return Parse(await response.Content.ReadAsStringAsync(cancellationToken), (int)response.StatusCode,
            result => result.ValueKind == JsonValueKind.Array ? ReadMessage(result[0]) : ReadMessage(result));
    }

    /// <summary>Enlace al mensaje: t.me/usuario/id en canales públicos, t.me/c/id/id en privados (sin el -100).</summary>
    public static string MessageLink(string chatId, string? username, long messageId)
    {
        if (!string.IsNullOrEmpty(username)) return $"https://t.me/{username}/{messageId}";
        string internalId = chatId.StartsWith("-100", StringComparison.Ordinal) ? chatId[4..] : chatId.TrimStart('-');
        return $"https://t.me/c/{internalId}/{messageId}";
    }

    private async Task<TelegramResult<T>> CallAsync<T>(string baseUrl, string token, string method, Dictionary<string, string>? fields, Func<JsonElement, T> read, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(HttpClients.Telegram);
        using var content = new FormUrlEncodedContent(fields ?? []);
        using var response = await client.PostAsync(MethodUrl(baseUrl, token, method), content, cancellationToken);
        return Parse(await response.Content.ReadAsStringAsync(cancellationToken), (int)response.StatusCode, read);
    }

    private static string MethodUrl(string baseUrl, string token, string method) => $"{baseUrl.TrimEnd('/')}/bot{token}/{method}";

    private static TelegramResult<T> Parse<T>(string body, int httpStatus, Func<JsonElement, T> read)
    {
        try
        {
            var root = JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body).RootElement;
            if (root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True && root.TryGetProperty("result", out var result))
                return TelegramResult<T>.Success(read(result));

            int code = root.TryGetProperty("error_code", out var c) && c.TryGetInt32(out int ci) ? ci : httpStatus;
            string description = root.TryGetProperty("description", out var desc) ? desc.GetString() ?? "Error de Telegram." : $"Telegram respondió HTTP {httpStatus}.";
            int? retryAfter = root.TryGetProperty("parameters", out var p) && p.TryGetProperty("retry_after", out var r) && r.TryGetInt32(out int ri) ? ri : null;
            return TelegramResult<T>.Fail(new TelegramError(code, description, retryAfter));
        }
        catch (JsonException)
        {
            return TelegramResult<T>.Fail(new TelegramError(httpStatus, $"Respuesta no válida de Telegram (HTTP {httpStatus}).", null));
        }
    }

    private static TelegramUser ReadUser(JsonElement user) => new(
        user.GetProperty("id").GetInt64(),
        user.TryGetProperty("username", out var u) ? u.GetString() ?? string.Empty : string.Empty,
        user.TryGetProperty("first_name", out var f) ? f.GetString() ?? string.Empty : string.Empty);

    private static TelegramChat ReadChat(JsonElement chat) => new(
        chat.GetProperty("id").GetInt64().ToString(),
        chat.TryGetProperty("title", out var t) ? t.GetString() ?? string.Empty : chat.TryGetProperty("first_name", out var f) ? f.GetString() ?? string.Empty : string.Empty,
        chat.TryGetProperty("username", out var u) ? u.GetString() : null,
        chat.TryGetProperty("type", out var type) ? type.GetString() ?? string.Empty : string.Empty);

    private static TelegramMember ReadMember(JsonElement member)
    {
        string status = member.TryGetProperty("status", out var s) ? s.GetString() ?? string.Empty : string.Empty;
        bool canPost = status == "creator"
            || (status == "administrator" && (!member.TryGetProperty("can_post_messages", out var post) || post.ValueKind == JsonValueKind.True));
        return new TelegramMember(status, canPost);
    }

    private static TelegramMessage ReadMessage(JsonElement message) => new(
        message.GetProperty("message_id").GetInt64(),
        message.TryGetProperty("chat", out var chat) && chat.TryGetProperty("username", out var u) ? u.GetString() : null);

    private static IReadOnlyList<TelegramChat> ReadChatsFromUpdates(JsonElement updates) =>
        updates.EnumerateArray().SelectMany(ChatsOf).DistinctBy(c => c.Id).ToList();

    private static IEnumerable<TelegramChat> ChatsOf(JsonElement update)
    {
        foreach (string kind in new[] { "my_chat_member", "channel_post", "message" })
            if (update.TryGetProperty(kind, out var item) && item.TryGetProperty("chat", out var chat))
            {
                var read = ReadChat(chat);
                if (read.Type is "channel" or "supergroup" or "group") yield return read;
            }
    }
}

public sealed record TelegramError(int Code, string Description, int? RetryAfterSeconds);

public sealed record TelegramResult<T>(T? Data, TelegramError? Error)
{
    public bool Ok => Error is null;
    public static TelegramResult<T> Success(T data) => new(data, null);
    public static TelegramResult<T> Fail(TelegramError error) => new(default, error);
}

public sealed record TelegramUser(long Id, string Username, string FirstName);

public sealed record TelegramChat(string Id, string Title, string? Username, string Type);

public sealed record TelegramMember(string Status, bool CanPost);

public sealed record TelegramMessage(long MessageId, string? ChatUsername);

public sealed record TelegramFile(string FilePath, string FileName, string ContentType);

/// <param name="AsDocument">Un solo archivo enviado como documento (PDF) en lugar de foto.</param>
public sealed record TelegramFiles(string ChatId, IReadOnlyList<TelegramFile> Items, string Caption, bool AsDocument, bool DisableNotification, bool ProtectContent);

public sealed record TelegramVideo(
    string ChatId,
    string FilePath,
    string FileName,
    string ContentType,
    string Caption,
    int? Width,
    int? Height,
    decimal? DurationSec,
    bool DisableNotification,
    bool ProtectContent);
