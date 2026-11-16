using Google.Apis.Auth.OAuth2.Responses;
using Google.Apis.Upload;
using Google.Apis.YouTube.v3;
using Google.Apis.YouTube.v3.Data;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.Repositories;
using YoutubeMeta.Api.Infrastructure.Storage;

namespace YoutubeMeta.Api.Infrastructure.External.YouTube;

public sealed class YoutubeVideoPublisher(
        PublisherServices services,
        YoutubeClientFactory clients,
        YoutubeStatusPoller poller,
        ActivityRepository activity,
        VideoStorage storage,
        ILogger<YoutubeVideoPublisher> logger) : PlatformPublisherBase(services)
{
    private static readonly TimeSpan ChunkTimeout = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan ExtrasTimeout = TimeSpan.FromMinutes(2);

    public override string Platform => Platforms.YouTube;

    /// <summary>Subidas largas: de una en una (tiene su propio carril, así que no frena a las demás plataformas).</summary>
    public override int BatchSize => 1;

    /// <summary>
    /// Subida reanudable desde el FileStream local (seekable): si el proceso se reinicia a mitad,
    /// la siguiente vuelta retoma la sesión guardada desde el último byte que YouTube confirmó.
    /// </summary>
    public override async Task<PublishStep> UploadAsync(PublicationDueItem item, string filePath, string leaseOwner, UploadHeartbeat heartbeat)
    {
        CancellationToken cancellationToken = heartbeat.Token;

        using var youtube = await clients.CreateAsync(item.ConnectionKey, ChunkTimeout, cancellationToken);
        if (youtube is null)
            return NoTokenStep("El canal de YouTube");

        await using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20,
            FileOptions.Asynchronous | FileOptions.SequentialScan);

        var insert = youtube.Videos.Insert(BuildVideo(item), "snippet,status", stream, item.ContentType);
        insert.NotifySubscribers = item.NotifySubscribers;
        insert.ChunkSize = Math.Max(Services.Settings.YoutubeChunkMb, 1) * 1024 * 1024;

        // Se dispara una vez, al abrir la sesión. Se guarda en el acto (cifrada: la URI permite subir sin token)
        // para poder reanudar aunque el proceso muera durante la subida. El evento es síncrono: se lanza la
        // escritura sin bloquear el hilo de la subida y se espera al terminar.
        Task sessionSaved = Task.CompletedTask;
        insert.UploadSessionData += session =>
            sessionSaved = Services.Publications.SessionSave(item.Id, leaseOwner, Services.Protector.Protect(session.UploadUri.ToString()), CancellationToken.None);

        insert.ProgressChanged += progress =>
        {
            if (progress.Status == UploadStatus.Uploading) heartbeat.Report(progress.BytesSent, stream.Length);
        };

        Video? uploaded = null;
        insert.ResponseReceived += video => uploaded = video;

        string? sessionUri = Services.Protector.UnprotectOrNull(item.SessionData);
        IUploadProgress result;
        if (sessionUri is null)
        {
            await activity.QuotaAdd(QuotaBuckets.Uploads, 1, item.ConnectionId, CancellationToken.None);
            result = await insert.UploadAsync(cancellationToken);
        }
        else
        {
            result = await insert.ResumeAsync(new Uri(sessionUri), cancellationToken);
        }
        await sessionSaved;

        if (result.Status == UploadStatus.Completed && uploaded?.Id is { } videoId)
            return PublishStep.Processing(videoId, $"https://youtu.be/{videoId}", await ApplyExtrasAsync(youtube, item, videoId));

        if (heartbeat.LeaseLost) return PublishStep.LeaseLost();
        cancellationToken.ThrowIfCancellationRequested();

        // UploadAsync/ResumeAsync no lanzan: el error llega en result.Exception.
        return YoutubeErrorClassifier.Classify(result.Exception);
    }

    public override Task<PublishStep> PollAsync(PublicationPollItem item, CancellationToken cancellationToken) => poller.PollAsync(item, cancellationToken);

    public override PublishStep Classify(Exception exception) => YoutubeErrorClassifier.Classify(exception);

    /// <summary>channels.list?mine=true: 1 unidad. Además confirma que el token sigue siendo de ese canal.</summary>
    public override async Task<ConnectionTest> TestAsync(ConnectionRow connection, CancellationToken cancellationToken)
    {
        try
        {
            using var youtube = await clients.CreateAsync(connection.ConnectionKey, TimeSpan.FromSeconds(30), cancellationToken);
            if (youtube == null) return new(false, "No hay token guardado: vuelve a conectar el canal.");

            var request = youtube.Channels.List("snippet");
            request.Mine = true;
            var response = await request.ExecuteAsync(cancellationToken);
            await activity.QuotaAdd(QuotaBuckets.General, 1, connection.Id, CancellationToken.None);

            var channel = response.Items?.FirstOrDefault();
            if (channel == null) return new(false, "La cuenta conectada ya no tiene canal.");
            return channel.Id == connection.ExternalId
                ? new(true, $"Conexión correcta con «{channel.Snippet?.Title}».")
                : new(false, "El acceso pertenece a otro canal. Vuelve a conectar el canal correcto.");
        }
        catch (TokenResponseException)
        {
            return new(false, "Google rechazó el acceso (revocado o caducado). Vuelve a conectar el canal.");
        }
    }

    /// <summary>
    /// Miniatura propia y lista de reproducción, con el video ya subido. Lo que falle aquí solo deja un aviso: nunca
    /// lanza (una excepción haría que el job volviera a subir un video que ya está en YouTube).
    /// </summary>
    private async Task<string?> ApplyExtrasAsync(YouTubeService youtube, PublicationDueItem item, string videoId)
    {
        var warnings = new List<string>();
        using var timeout = new CancellationTokenSource(ExtrasTimeout);

        if (item.PosterPath is { Length: > 0 } posterPath)
        {
            try
            {
                await using var poster = File.OpenRead(storage.Resolve(posterPath));
                var upload = await youtube.Thumbnails.Set(videoId, poster, "image/jpeg").UploadAsync(timeout.Token);
                await activity.QuotaAdd(QuotaBuckets.General, 50, item.ConnectionId, CancellationToken.None);
                if (upload.Status != UploadStatus.Completed) throw upload.Exception ?? new InvalidOperationException("Miniatura no completada.");
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Publicación {Id}: YouTube no aceptó la miniatura.", item.Id);
                warnings.Add("YouTube no aceptó la miniatura propia (el canal debe estar verificado por teléfono); se usa la automática.");
            }
        }

        if (item.Options.PlaylistId is { Length: > 0 } playlistId)
        {
            try
            {
                var entry = new Google.Apis.YouTube.v3.Data.PlaylistItem
                {
                    Snippet = new PlaylistItemSnippet { PlaylistId = playlistId, ResourceId = new ResourceId { Kind = "youtube#video", VideoId = videoId } }
                };
                await youtube.PlaylistItems.Insert(entry, "snippet").ExecuteAsync(timeout.Token);
                await activity.QuotaAdd(QuotaBuckets.General, 50, item.ConnectionId, CancellationToken.None);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Publicación {Id}: no se pudo añadir a la lista {Playlist}.", item.Id, playlistId);
                warnings.Add("No se pudo añadir el video a la lista de reproducción; añádelo a mano en YouTube Studio.");
            }
        }

        return warnings.Count == 0 ? null : string.Join(" ", warnings);
    }

    /// <summary>Listas de reproducción del canal (1 unidad), para elegir una al publicar.</summary>
    public async Task<IReadOnlyList<PlaylistOption>> PlaylistsAsync(ConnectionRow connection, CancellationToken cancellationToken)
    {
        using var youtube = await clients.CreateAsync(connection.ConnectionKey, TimeSpan.FromSeconds(30), cancellationToken);
        if (youtube is null) return [];

        var request = youtube.Playlists.List("snippet,contentDetails");
        request.Mine = true;
        request.MaxResults = 50;
        var response = await request.ExecuteAsync(cancellationToken);
        await activity.QuotaAdd(QuotaBuckets.General, 1, connection.Id, CancellationToken.None);

        return (response.Items ?? [])
            .Select(p => new PlaylistOption { Id = p.Id, Title = p.Snippet?.Title ?? p.Id, ItemCount = p.ContentDetails?.ItemCount })
            .OrderBy(p => p.Title)
            .ToList();
    }

    private static Video BuildVideo(PublicationDueItem item) => new()
    {
        Snippet = new VideoSnippet
        {
            Title = item.Title,
            Description = item.Description,
            Tags = PublicationRules.SplitTags(item.Tags).ToList(),
            CategoryId = item.CategoryId,
            DefaultLanguage = "es",
            DefaultAudioLanguage = "es"
        },
        Status = new VideoStatus
        {
            // La privacidad siempre explícita (elección del usuario). Programado = privado hasta publishAt.
            PrivacyStatus = item.PublishAt is null ? item.PrivacyStatus : PrivacyStatus.Private,
            PublishAtDateTimeOffset = item.PublishAt,
            SelfDeclaredMadeForKids = item.MadeForKids,
            ContainsSyntheticMedia = item.ContainsSyntheticMedia,
            License = "youtube",
            Embeddable = true,
            PublicStatsViewable = true
        }
    };
}
