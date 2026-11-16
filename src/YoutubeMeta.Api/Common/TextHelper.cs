namespace YoutubeMeta.Api.Common;

public static class TextHelper
{
    public static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    /// <summary>El primer valor con texto, sin espacios alrededor.</summary>
    public static string? FirstNonBlank(params string?[] values) => values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v))?.Trim();
}
