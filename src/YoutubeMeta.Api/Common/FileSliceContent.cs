using System.Net.Http.Headers;

namespace YoutubeMeta.Api.Common;

/// <summary>
/// Cuerpo HTTP con [offset, offset+length) de un archivo, leído por bloques sin cargarlo en memoria.
/// <c>progress</c> recibe los bytes enviados de este tramo (para el latido de la subida).
/// </summary>
public sealed class FileSliceContent : HttpContent
{
    private const int BufferSize = 1 << 16;

    private readonly string _path;
    private readonly long _offset;
    private readonly long _length;
    private readonly Action<long>? _progress;

    public FileSliceContent(string path, long offset, long length, Action<long>? progress = null, string contentType = "application/octet-stream")
    {
        _path = path;
        _offset = offset;
        _length = length;
        _progress = progress;
        Headers.ContentType = new MediaTypeHeaderValue(contentType);
    }

    protected override async Task SerializeToStreamAsync(Stream stream, System.Net.TransportContext? context, CancellationToken cancellationToken)
    {
        await using var file = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize, FileOptions.Asynchronous);
        file.Seek(_offset, SeekOrigin.Begin);

        byte[] buffer = new byte[BufferSize];
        long sent = 0;
        while (sent < _length)
        {
            int read = await file.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, _length - sent)), cancellationToken);
            if (read == 0) throw new IOException("El archivo terminó antes de lo esperado.");
            await stream.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            sent += read;
            _progress?.Invoke(sent);
        }
    }

    protected override Task SerializeToStreamAsync(Stream stream, System.Net.TransportContext? context) =>
        SerializeToStreamAsync(stream, context, CancellationToken.None);

    protected override bool TryComputeLength(out long length)
    {
        length = _length;
        return true;
    }
}
