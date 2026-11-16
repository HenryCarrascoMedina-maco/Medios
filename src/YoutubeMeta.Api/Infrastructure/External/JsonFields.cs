using System.Text.Json;

namespace YoutubeMeta.Api.Infrastructure.External;

/// <summary>Lectura tolerante de las respuestas JSON de LinkedIn, Teams y TikTok: un campo ausente o nulo da "" o 0.</summary>
internal static class JsonFields
{
    /// <summary>default (no un objeto) si la respuesta viene vacía o no es JSON.</summary>
    public static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        string text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(text)) return default;
        try
        {
            return JsonDocument.Parse(text).RootElement.Clone();
        }
        catch (JsonException)
        {
            return default;
        }
    }

    public static string Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? value.ToString() : string.Empty;

    public static long Number(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.TryGetInt64(out long n) ? n : 0;
}
