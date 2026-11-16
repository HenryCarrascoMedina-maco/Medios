using Microsoft.AspNetCore.StaticFiles;
using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;
using YoutubeMeta.Api.Infrastructure.Storage;

#region RESPONSES
using MetadataResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Entities.TusVideoMetadata>;
using OffsetResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<(long Offset, YoutubeMeta.Api.Domain.Entities.TusVideoMetadata Metadata)>;
using AppendResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<long>;
using DeleteResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<bool>;
using PosterResult = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Responses.PosterResponse>;
#endregion

namespace YoutubeMeta.Api.Application.Services;

/// <summary>
/// Servidor TUS de videos: cada subida vive en tus/{uploadId}/ con metadata.json y upload.bin, el offset es el
/// tamaño de upload.bin, y al recibir el último byte se finaliza (mover a videos/ y registrar en BD).
/// </summary>
public sealed class VideoUploadService(
        VideoStorage storage,
        VideoRepository videos,
        IProgressNotifier notifier,
        IOptions<StorageSettings> settings,
        ExceptionHelper exception,
        ILogger<VideoUploadService> logger)
{
    public const string ConflictPrefix = "CONFLICT";
    public const string NotFoundMessage = "No existe recurso TUS.";
    /// <summary>Fallo al finalizar con todos los bytes recibidos: el controlador responde 503 para que el cliente reintente.</summary>
    public const string FinalizePrefix = "FINALIZE";
    private const long MaxPosterBytes = 2 * 1024 * 1024;

    private static readonly ConcurrentDictionary<string, SemaphoreSlim> FinalizeLocks = new();
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    private readonly StorageSettings _settings = settings.Value;

    public TusConfigResponse Config => new()
    {
        TtlMinutes = _settings.TusTtlMinutes,
        MaxUploadBytes = _settings.MaxUploadBytes,
        AllowedExtensions = _settings.AllExtensions
    };

    public Task<MetadataResponse> InitializeAsync(string uploadId, string metadataHeader, long uploadLength, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<MetadataResponse>(async () =>
        {
            var metadata = BuildMetadata(metadataHeader, uploadLength, userName);

            if (string.IsNullOrWhiteSpace(metadata.FileName)) return MetadataResponse.Fail("La metadata fileName es requerida.");
            if (uploadLength > _settings.MaxUploadBytes) return MetadataResponse.Fail($"El archivo supera el máximo de {_settings.MaxUploadGb} GB.");
            if (!_settings.AllExtensions.Contains(Extension(metadata.FileName), StringComparer.OrdinalIgnoreCase))
                return MetadataResponse.Fail($"Formato no admitido. Se aceptan: {string.Join(", ", _settings.AllExtensions)}.");
            if (uploadLength > storage.FreeBytes()) return MetadataResponse.Fail("No hay espacio suficiente en el almacenamiento para este archivo.");

            await SaveMetadataAsync(uploadId, metadata, cancellationToken);
            return MetadataResponse.Ok(metadata);
        });

    public Task<OffsetResponse> GetOffsetAsync(string uploadId, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<OffsetResponse>(async () =>
        {
            var metadata = await ReadMetadataAsync(uploadId, cancellationToken);
            if (metadata == null) return OffsetResponse.Fail(NotFoundMessage);

            long offset = metadata.IsCompleted ? metadata.UploadLength : CurrentOffset(uploadId, metadata);
            if (!metadata.IsCompleted && offset >= metadata.UploadLength)
            {
                string? error = await FinalizeAsync(uploadId, metadata, cancellationToken);
                if (error != null) return OffsetResponse.Fail(error);
                offset = metadata.UploadLength;
            }

            return OffsetResponse.Ok((offset, metadata));
        });

    public Task<AppendResponse> AppendAsync(string uploadId, Stream content, long requestedOffset, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<AppendResponse>(async () =>
        {
            var metadata = await ReadMetadataAsync(uploadId, cancellationToken);
            if (metadata == null) return AppendResponse.Fail(NotFoundMessage);
            if (metadata.IsCompleted) return AppendResponse.Ok(metadata.UploadLength);

            long currentOffset = CurrentOffset(uploadId, metadata);
            if (requestedOffset != currentOffset)
                return AppendResponse.Fail($"{ConflictPrefix}: El offset actual es {currentOffset} pero se solicitó {requestedOffset}");

            // Si la conexión se corta a mitad de la parte, queda escrito lo recibido y el cliente TUS retoma desde
            // ese offset (HEAD). Nunca se escribe más de lo declarado en Upload-Length.
            bool overflow;
            await using (var target = new FileStream(storage.TusFilePath(uploadId), FileMode.Append, FileAccess.Write, FileShare.Read, 1 << 16, FileOptions.Asynchronous))
            {
                overflow = await CopyLimitedAsync(content, target, metadata.UploadLength - currentOffset, cancellationToken);
            }

            metadata.LastActivityAt = TimeClock.UtcNow;
            await SaveMetadataAsync(uploadId, metadata, cancellationToken);

            long newOffset = CurrentOffset(uploadId, metadata);
            if (overflow) return AppendResponse.Fail("El tamaño acumulado excede Upload-Length.");

            if (newOffset == metadata.UploadLength)
            {
                string? error = await FinalizeAsync(uploadId, metadata, cancellationToken);
                if (error != null) return AppendResponse.Fail(error);
            }

            return AppendResponse.Ok(newOffset);
        });

    public Task<DeleteResponse> DeleteAsync(string uploadId, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<DeleteResponse>(async () =>
        {
            var metadata = await ReadMetadataAsync(uploadId, cancellationToken);
            if (metadata == null) return DeleteResponse.Fail(NotFoundMessage);

            await TryDeleteDirectoryAsync(uploadId);
            return DeleteResponse.Ok(true);
        });

    /// <summary>La miniatura la genera el navegador antes de subir; viaja como posterId en los metadatos TUS.</summary>
    public Task<PosterResult> StorePosterAsync(IFormFile? file, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<PosterResult>(async () =>
        {
            if (PosterError(file) is { } error) return PosterResult.Fail(error);

            string posterId = Guid.NewGuid().ToString("N");
            await SaveTempPosterAsync(storage, file!, posterId, cancellationToken);
            return PosterResult.Ok(new PosterResponse { PosterId = posterId });
        });

    /// <summary>La miniatura debe ser un JPEG de hasta 2 MB; null si es válida.</summary>
    public static string? PosterError(IFormFile? file)
    {
        if (file == null || file.Length == 0) return "No se recibió la miniatura.";
        if (file.Length > MaxPosterBytes) return "La miniatura supera 2 MB.";
        if (!string.Equals(file.ContentType, "image/jpeg", StringComparison.OrdinalIgnoreCase)) return "La miniatura debe ser JPEG.";
        return null;
    }

    public static async Task<string> SaveTempPosterAsync(VideoStorage storage, IFormFile file, string posterId, CancellationToken cancellationToken)
    {
        string path = storage.TempPosterPath(posterId);
        Directory.CreateDirectory(storage.TempPosterRoot);
        await using var target = File.Create(path);
        await file.CopyToAsync(target, cancellationToken);
        return path;
    }

    public async Task<int> CleanupAsync(TimeSpan tempPosterAge, CancellationToken cancellationToken)
    {
        int removed = 0;

        if (Directory.Exists(storage.TusRoot))
        {
            foreach (string directory in Directory.EnumerateDirectories(storage.TusRoot))
            {
                cancellationToken.ThrowIfCancellationRequested();
                string uploadId = Path.GetFileName(directory);
                var metadata = await ReadRawMetadataAsync(uploadId, cancellationToken);
                if (metadata == null || metadata.IsCompleted || IsExpired(metadata))
                {
                    await TryDeleteDirectoryAsync(uploadId);
                    removed++;
                }
            }
        }

        if (Directory.Exists(storage.TempPosterRoot))
        {
            DateTime limit = TimeClock.UtcNow - tempPosterAge;
            foreach (var poster in new DirectoryInfo(storage.TempPosterRoot).EnumerateFiles().Where(f => f.LastWriteTimeUtc < limit))
            {
                try
                {
                    poster.Delete();
                    removed++;
                }
                catch (IOException)
                {
                }
            }
        }

        return removed;
    }

    #region FINALIZE
    private async Task<string?> FinalizeAsync(string uploadId, TusVideoMetadata metadata, CancellationToken cancellationToken)
    {
        if (metadata.IsCompleted) return null;

        // Una sola finalización por uploadId: el cliente puede repetir HEAD mientras otra
        // petición está finalizando.
        SemaphoreSlim gate = FinalizeLocks.GetOrAdd(uploadId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        string? error = null;
        try
        {
            var current = await ReadMetadataAsync(uploadId, CancellationToken.None);
            if (current == null || current.IsCompleted) return null;

            // Con todos los bytes recibidos se termina aunque el cliente aborte la petición.
            error = await FinalizeCoreAsync(uploadId, current);
            return error;
        }
        finally
        {
            gate.Release();
            if (error == null) FinalizeLocks.TryRemove(uploadId, out _);
        }
    }

    /// <summary>
    /// Idempotente: el destino se guarda en metadata.json ANTES de mover el archivo, y el alta en BD no duplica un
    /// video con la misma ruta. Si IIS recicla en cualquier punto, la siguiente petición (HEAD) continúa donde quedó.
    /// </summary>
    private async Task<string?> FinalizeCoreAsync(string uploadId, TusVideoMetadata metadata)
    {
        string uploadPath = storage.TusFilePath(uploadId);

        if (metadata.FinalPath is null)
        {
            if (!File.Exists(uploadPath)) return $"{FinalizePrefix}: No existe archivo temporal para completar la carga TUS.";
            metadata.FinalPath = VideoStorage.NewVideoRelativePath(Extension(metadata.FileName));
            string? posterSource = IsHexId(metadata.PosterId) ? storage.TempPosterPath(metadata.PosterId!) : null;
            if (posterSource != null && File.Exists(posterSource)) metadata.FinalPosterPath = VideoStorage.NewPosterRelativePath();
            await SaveMetadataAsync(uploadId, metadata, CancellationToken.None);
        }

        string videoPath = metadata.FinalPath;
        string? posterPath = metadata.FinalPosterPath;

        if (File.Exists(uploadPath)) storage.MoveInto(uploadPath, videoPath);
        else if (!File.Exists(storage.Resolve(videoPath))) return $"{FinalizePrefix}: No existe archivo temporal para completar la carga TUS.";

        if (posterPath != null && IsHexId(metadata.PosterId) && File.Exists(storage.TempPosterPath(metadata.PosterId!)))
            storage.MoveInto(storage.TempPosterPath(metadata.PosterId!), posterPath);
        if (posterPath != null && !File.Exists(storage.Resolve(posterPath))) posterPath = null;

        int videoId;
        try
        {
            videoId = await videos.Create(new VideoRow
            {
                Title = string.IsNullOrWhiteSpace(metadata.Title) ? Path.GetFileNameWithoutExtension(metadata.FileName) : metadata.Title.Trim(),
                OriginalFileName = metadata.FileName,
                StoragePath = videoPath,
                PosterPath = posterPath,
                ContentType = ResolveContentType(metadata),
                SizeBytes = metadata.UploadLength,
                MediaKind = StorageSettings.KindOf(Extension(metadata.FileName))
            }, metadata, CancellationToken.None);
        }
        catch (Exception ex)
        {
            // El archivo se queda en su destino (anotado en metadata.json): el siguiente HEAD reintenta solo el alta.
            logger.LogError(ex, "TUS {UploadId}: no se pudo registrar el video.", uploadId);
            return $"{FinalizePrefix}: No se pudo registrar el video. Se reintentará.";
        }

        metadata.IsCompleted = true;
        metadata.VideoId = videoId;
        await SaveMetadataAsync(uploadId, metadata, CancellationToken.None);
        await TryDeleteDirectoryAsync(uploadId);

        await notifier.NotifyAsync(RealTimeEntities.VideoUpload, new { videoId, isFinal = true });
        return null;
    }
    #endregion

    #region METADATA
    private static TusVideoMetadata BuildMetadata(string metadataHeader, long uploadLength, string userName)
    {
        Dictionary<string, string> values = new(StringComparer.OrdinalIgnoreCase);
        foreach (string segment in metadataHeader.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            string[] parts = segment.Split(' ', 2, StringSplitOptions.TrimEntries);
            if (parts.Length == 0 || string.IsNullOrWhiteSpace(parts[0])) continue;
            values[parts[0]] = parts.Length == 2 ? Decode(parts[1]) : string.Empty;
        }

        string Value(string key) => values.TryGetValue(key, out string? v) ? v : string.Empty;
        DateTime now = TimeClock.UtcNow;

        return new TusVideoMetadata
        {
            FileName = Path.GetFileName(Value("fileName").Length > 0 ? Value("fileName") : Value("filename")),
            FileType = Value("fileType"),
            Title = Value("title"),
            DurationSec = decimal.TryParse(Value("durationSec"), System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out decimal d) ? Math.Round(d, 3) : null,
            Width = int.TryParse(Value("width"), out int w) && w > 0 ? w : null,
            Height = int.TryParse(Value("height"), out int h) && h > 0 ? h : null,
            PosterId = Value("posterId"),
            UploadLength = uploadLength,
            UserName = userName,
            CreatedAt = now,
            LastActivityAt = now
        };
    }

    private static string Decode(string value)
    {
        try
        {
            return Encoding.UTF8.GetString(Convert.FromBase64String(value));
        }
        catch (FormatException)
        {
            return string.Empty;
        }
    }

    private bool IsExpired(TusVideoMetadata metadata) =>
        !metadata.IsCompleted && metadata.LastActivityAt.AddMinutes(_settings.TusTtlMinutes) < TimeClock.UtcNow;

    /// <summary>Una sesión caducada se trata como inexistente (404): el cliente empieza de cero.</summary>
    private async Task<TusVideoMetadata?> ReadMetadataAsync(string uploadId, CancellationToken cancellationToken)
    {
        var metadata = await ReadRawMetadataAsync(uploadId, cancellationToken);
        return metadata == null || IsExpired(metadata) ? null : metadata;
    }

    private async Task<TusVideoMetadata?> ReadRawMetadataAsync(string uploadId, CancellationToken cancellationToken)
    {
        if (!IsHexId(uploadId)) return null;
        string path = storage.TusMetadataPath(uploadId);
        if (!File.Exists(path)) return null;

        string content = await File.ReadAllTextAsync(path, cancellationToken);
        if (string.IsNullOrWhiteSpace(content)) return null;
        try
        {
            return JsonSerializer.Deserialize<TusVideoMetadata>(content);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "TUS {UploadId}: metadata.json dañado; la sesión se descarta.", uploadId);
            return null;
        }
    }

    /// <summary>Escritura atómica: a un temporal y se reemplaza. Un corte nunca deja un metadata.json a medias.</summary>
    private async Task SaveMetadataAsync(string uploadId, TusVideoMetadata metadata, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(storage.TusDirectory(uploadId));
        string path = storage.TusMetadataPath(uploadId);
        string temp = path + ".tmp";
        await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(metadata), cancellationToken);
        File.Move(temp, path, overwrite: true);
    }

    /// <summary>Bytes recibidos. Si la finalización ya movió el archivo a su destino, están todos.</summary>
    private long CurrentOffset(string uploadId, TusVideoMetadata metadata)
    {
        var file = new FileInfo(storage.TusFilePath(uploadId));
        if (file.Exists) return file.Length;
        return metadata.FinalPath != null && File.Exists(storage.Resolve(metadata.FinalPath)) ? metadata.UploadLength : 0;
    }

    /// <summary>Copia como mucho <paramref name="limit"/> bytes. true = el cliente envió más de lo declarado.</summary>
    public static async Task<bool> CopyLimitedAsync(Stream source, Stream target, long limit, CancellationToken cancellationToken)
    {
        byte[] buffer = new byte[1 << 16];
        long remaining = Math.Max(limit, 0);
        while (true)
        {
            int read = await source.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, Math.Max(remaining, 1))), cancellationToken);
            if (read == 0) return false;
            if (remaining == 0) return true;
            int keep = (int)Math.Min(read, remaining);
            await target.WriteAsync(buffer.AsMemory(0, keep), cancellationToken);
            remaining -= keep;
            if (keep < read) return true;
        }
    }

    /// <summary>Tolera bloqueos transitorios de Windows; si no se puede, lo limpia StorageCleanupJob.</summary>
    private async Task TryDeleteDirectoryAsync(string uploadId)
    {
        for (int attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                string directory = storage.TusDirectory(uploadId);
                if (Directory.Exists(directory)) Directory.Delete(directory, true);
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                if (attempt < 3) await Task.Delay(100 * attempt);
            }
        }
    }
    #endregion

    public static string NewUploadId() => Guid.NewGuid().ToString("N");

    private static bool IsHexId(string? value) => value is { Length: 32 } && value.All(Uri.IsHexDigit);

    private static string Extension(string fileName) => Path.GetExtension(fileName).TrimStart('.').ToLowerInvariant();

    private static string ResolveContentType(TusVideoMetadata metadata)
    {
        if (metadata.FileType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)) return metadata.FileType;
        return ContentTypes.TryGetContentType(metadata.FileName, out string? type) ? type : "application/octet-stream";
    }
}
