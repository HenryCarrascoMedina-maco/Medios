using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using YoutubeMeta.Api.Infrastructure.External.Meta;

namespace YoutubeMeta.Api.Infrastructure.External.WhatsApp;

/// <summary>
/// WhatsApp Business Cloud API. Es la misma Graph API de Meta: comparte <see cref="MetaGraphClient"/> (HttpClient sin
/// loggers, token en la cabecera y el mismo formato de error). El token es el del usuario del sistema con
/// whatsapp_business_messaging y whatsapp_business_management.
/// </summary>
public sealed class WhatsAppClient(MetaGraphClient graph, IHttpClientFactory httpClientFactory)
{
    private const string NumberFields = "id,display_phone_number,verified_name,quality_rating";

    public async Task<MetaResult<IReadOnlyList<WhatsAppNumber>>> NumbersAsync(string wabaId, string token, CancellationToken cancellationToken)
    {
        var (root, error) = await graph.CallAsync(HttpMethod.Get,
            $"{Uri.EscapeDataString(wabaId)}/phone_numbers?fields={NumberFields}", token, null, cancellationToken);
        if (error != null) return MetaResult<IReadOnlyList<WhatsAppNumber>>.Fail(error);

        var numbers = MetaGraphClient.DataItems(root).Select(n => new WhatsAppNumber(
            Text(n, "id") ?? string.Empty, wabaId, Text(n, "display_phone_number") ?? string.Empty,
            Text(n, "verified_name") ?? string.Empty, Text(n, "quality_rating"))).ToList();
        return MetaResult<IReadOnlyList<WhatsAppNumber>>.Success(numbers);
    }

    public async Task<MetaResult<WhatsAppNumber>> NumberAsync(string phoneNumberId, string wabaId, string token, CancellationToken cancellationToken)
    {
        var (root, error) = await graph.CallAsync(HttpMethod.Get,
            $"{Uri.EscapeDataString(phoneNumberId)}?fields={NumberFields}", token, null, cancellationToken);
        return error != null
            ? MetaResult<WhatsAppNumber>.Fail(error)
            : MetaResult<WhatsAppNumber>.Success(new WhatsAppNumber(Text(root, "id") ?? phoneNumberId, wabaId,
                Text(root, "display_phone_number") ?? string.Empty, Text(root, "verified_name") ?? string.Empty, Text(root, "quality_rating")));
    }

    /// <summary>
    /// Envía un mensaje: <paramref name="content"/> lleva type y su objeto (text, image, document, video, template).
    /// <paramref name="replyTo"/> cita un mensaje anterior. Devuelve el wamid.
    /// </summary>
    public async Task<MetaResult<string>> SendAsync(string phoneNumberId, string token, string to, JsonObject content, string? replyTo, CancellationToken cancellationToken)
    {
        content["messaging_product"] = "whatsapp";
        content["recipient_type"] = "individual";
        content["to"] = to;
        if (replyTo is not null) content["context"] = new JsonObject { ["message_id"] = replyTo };

        var (root, error) = await graph.CallAsync(HttpMethod.Post, $"{Uri.EscapeDataString(phoneNumberId)}/messages", token, MetaGraphClient.Json(content), cancellationToken);
        if (error != null) return MetaResult<string>.Fail(error);
        string id = root.TryGetProperty("messages", out var messages) && messages.ValueKind == JsonValueKind.Array && messages.GetArrayLength() > 0
            ? Text(messages[0], "id") ?? string.Empty : string.Empty;
        return MetaResult<string>.Success(id);
    }

    /// <summary>Sube un archivo para enviarlo después por su id (no hace falta una URL pública).</summary>
    public async Task<MetaResult<string>> UploadAsync(string phoneNumberId, string token, string filePath, string fileName, string contentType, CancellationToken cancellationToken)
    {
        using var form = new MultipartFormDataContent
        {
            { new StringContent("whatsapp"), "messaging_product" },
            { new StringContent(contentType), "type" },
            { new FileSliceContent(filePath, 0, new FileInfo(filePath).Length, null, contentType), "file", fileName }
        };
        var (root, error) = await graph.CallAsync(HttpMethod.Post, $"{Uri.EscapeDataString(phoneNumberId)}/media", token, form, cancellationToken);
        return error != null ? MetaResult<string>.Fail(error) : MetaResult<string>.Success(Text(root, "id") ?? string.Empty);
    }

    /// <summary>Plantillas de la cuenta de WhatsApp Business (solo las aprobadas sirven fuera de la ventana de 24 h).</summary>
    public async Task<MetaResult<IReadOnlyList<WhatsAppTemplateItem>>> TemplatesAsync(string wabaId, string token, CancellationToken cancellationToken)
    {
        var (root, error) = await graph.CallAsync(HttpMethod.Get,
            $"{Uri.EscapeDataString(wabaId)}/message_templates?fields=name,language,status,category,components&limit=200", token, null, cancellationToken);
        if (error != null) return MetaResult<IReadOnlyList<WhatsAppTemplateItem>>.Fail(error);

        var list = new List<WhatsAppTemplateItem>();
        foreach (var t in MetaGraphClient.DataItems(root))
        {
            string body = t.TryGetProperty("components", out var components) && components.ValueKind == JsonValueKind.Array
                ? components.EnumerateArray().Where(c => Text(c, "type") == "BODY").Select(c => Text(c, "text")).FirstOrDefault() ?? string.Empty
                : string.Empty;
            list.Add(new WhatsAppTemplateItem
            {
                Name = Text(t, "name") ?? string.Empty,
                Language = Text(t, "language") ?? string.Empty,
                Category = Text(t, "category") ?? string.Empty,
                Status = Text(t, "status") ?? string.Empty,
                Body = body,
                ParamCount = CountParams(body)
            });
        }
        return MetaResult<IReadOnlyList<WhatsAppTemplateItem>>.Success(list);
    }

    /// <summary>Descarga un archivo recibido: primero se pide su URL temporal y luego se baja con el mismo token.</summary>
    public async Task<(Stream Content, string ContentType)?> DownloadAsync(string mediaId, string token, CancellationToken cancellationToken)
    {
        var (root, error) = await graph.CallAsync(HttpMethod.Get, Uri.EscapeDataString(mediaId), token, null, cancellationToken);
        if (error != null || Text(root, "url") is not { } url) return null;

        var client = httpClientFactory.CreateClient(HttpClients.MetaUpload);
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            response.Dispose();
            return null;
        }
        return (await response.Content.ReadAsStreamAsync(cancellationToken), Text(root, "mime_type") ?? "application/octet-stream");
    }

    /// <summary>Cuántas variables {{1}}, {{2}}… tiene el texto de una plantilla.</summary>
    public static int CountParams(string body) =>
        System.Text.RegularExpressions.Regex.Matches(body, @"\{\{\s*(\d+)\s*\}\}").Select(m => int.Parse(m.Groups[1].Value)).DefaultIfEmpty(0).Max();

    private static string? Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}

public sealed record WhatsAppNumber(string Id, string WabaId, string DisplayPhoneNumber, string VerifiedName, string? QualityRating);
