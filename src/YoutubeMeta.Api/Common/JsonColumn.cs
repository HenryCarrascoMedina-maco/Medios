using System.Text.Json;
using System.Text.Json.Serialization;

namespace YoutubeMeta.Api.Common;

/// <summary>Columnas JSON de la BD (Extra, Options, Settings…): camelCase, sin nulos y un JSON dañado se lee como vacío.</summary>
public static class JsonColumn
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    /// <summary>null si no queda nada que guardar ("{}").</summary>
    public static string? Serialize<T>(T value)
    {
        string json = JsonSerializer.Serialize(value, Options);
        return json == "{}" ? null : json;
    }

    public static T Parse<T>(string? json) where T : new()
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try
        {
            return JsonSerializer.Deserialize<T>(json, Options) ?? new();
        }
        catch (JsonException)
        {
            return new();
        }
    }
}
