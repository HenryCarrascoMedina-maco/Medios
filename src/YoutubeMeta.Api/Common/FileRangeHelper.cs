using System.Net.Http.Headers;

namespace YoutubeMeta.Api.Common;

public static class FileRangeHelper
{
    /// <summary>
    /// Un rango abierto ("bytes=N-") se recorta a un pedazo de <paramref name="chunkSize"/> para que el reproductor
    /// cargue el video por partes y no mantenga abierta una respuesta con el archivo completo.
    /// </summary>
    public static bool TryParseVideoChunkedRange(string rangeHeader, long fileSize, int chunkSize, out long startByte, out long endByte)
    {
        startByte = 0;
        endByte = 0;

        if (fileSize <= 0 || chunkSize <= 0 || string.IsNullOrWhiteSpace(rangeHeader)) return false;

        RangeHeaderValue? rangeValue;
        try
        {
            rangeValue = RangeHeaderValue.Parse(rangeHeader);
        }
        catch (FormatException)
        {
            return false;
        }

        var firstRange = rangeValue.Ranges.FirstOrDefault();
        if (firstRange == null) return false;

        if (firstRange.From.HasValue)
        {
            startByte = firstRange.From.Value;
            endByte = firstRange.To ?? Math.Min(startByte + chunkSize - 1, fileSize - 1);
        }
        else if (firstRange.To.HasValue)
        {
            long suffixLength = firstRange.To.Value;
            if (suffixLength <= 0) return false;

            startByte = Math.Max(fileSize - suffixLength, 0);
            endByte = fileSize - 1;
        }
        else
        {
            return false;
        }

        if (startByte < 0 || startByte >= fileSize || endByte < startByte) return false;

        endByte = Math.Min(endByte, fileSize - 1);
        return true;
    }
}
