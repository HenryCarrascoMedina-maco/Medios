using System.Text.Json;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Infrastructure.External.Meta;

/// <summary>
/// Publicaciones en una Página de Facebook. Texto, enlace y fotos van al muro (las fotos se suben antes sin publicar
/// y se adjuntan; la sesión guarda sus ids para no repetirlas). Primer comentario con /comments.
/// <para>Video: subida binaria por fases (start → transfer → finish) con token de Página. No necesita exponer el archivo en
/// Internet como file_url. La sesión (id y offsets) se guarda cifrada tras cada parte para continuar donde quedó si
/// el proceso se reinicia. El paso irreversible es «finish»: si se corta ahí, <see cref="VerifyAsync"/> mira el
/// video en Facebook y, si quedó a medias, lo termina sin volver a subirlo.</para>
/// </summary>
public sealed class FacebookPublisher(PublisherServices services, MetaGraphClient graph, FacebookStatusPoller poller)
    : PlatformPublisherBase(services), IFirstCommentPublisher
{
    private const int MaxOffsetCorrections = 3;
    private const string Account = "La Página de Facebook";

    private sealed record Session(string SessionId, string VideoId, long StartOffset, long EndOffset);

    /// <summary>Fotos ya subidas (sin publicar) de un post del muro: id del archivo → id de la foto.</summary>
    private sealed class PostSession
    {
        public Dictionary<int, string> Photos { get; set; } = [];
    }

    public override string Platform => Platforms.Facebook;

    public override Task<PublishStep> PollAsync(PublicationPollItem item, CancellationToken cancellationToken) => poller.PollAsync(item, cancellationToken);

    public override async Task<ConnectionTest> TestAsync(ConnectionRow connection, CancellationToken cancellationToken)
    {
        string? pageToken = Services.Protector.UnprotectOrNull(connection.SecretCipher);
        if (pageToken == null) return new(false, "No hay token guardado: vuelve a conectar la Página.");

        var page = await graph.PageAsync(connection.ExternalId, pageToken, cancellationToken);
        return page.Ok ? new(true, $"Conexión correcta con «{page.Data!.Name}».") : new(false, MetaErrorClassifier.Friendly(page.Error!));
    }

    public override async Task<PublishStep> UploadAsync(PublicationDueItem item, string filePath, string leaseOwner, UploadHeartbeat heartbeat)
    {
        CancellationToken cancellationToken = heartbeat.Token;
        string pageId = item.AccountExternalId;

        string? pageToken = await TokenAsync(item.ConnectionKey, cancellationToken);
        if (pageToken is null) return NoTokenStep(Account);
        if (item.PostKind != PostKinds.Video) return await FeedAsync(item, pageToken, leaseOwner, heartbeat);

        long fileSize = new FileInfo(filePath).Length;
        Session? session = ReadSession<Session>(item.SessionData);

        if (session is null)
        {
            var started = await graph.StartUploadAsync(pageId, pageToken, fileSize, cancellationToken);
            if (!started.Ok) return MetaErrorClassifier.Classify(started.Error!);

            var s = started.Data!;
            session = new Session(s.SessionId, s.VideoId, s.StartOffset, s.EndOffset);
            await SaveSessionAsync(item, leaseOwner, session, cancellationToken);
        }

        int corrections = 0;
        while (session.StartOffset < session.EndOffset)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var sent = await graph.TransferAsync(pageId, pageToken, session.SessionId, filePath, session.StartOffset, session.EndOffset, cancellationToken);
            if (!sent.Ok)
            {
                // Offset desfasado: Meta indica desde dónde continuar.
                if (IsInvalidOffset(sent.Error!) && corrections++ < MaxOffsetCorrections && TryReadOffsets(sent.Error!, out long start, out long end))
                {
                    session = session with { StartOffset = start, EndOffset = end };
                    continue;
                }
                return heartbeat.LeaseLost ? PublishStep.LeaseLost() : MetaErrorClassifier.Classify(sent.Error!);
            }

            session = session with { StartOffset = sent.Data.Start, EndOffset = sent.Data.End };
            await SaveSessionAsync(item, leaseOwner, session, cancellationToken);
            heartbeat.Report(session.StartOffset, fileSize);
        }

        await heartbeat.MarkCommittingAsync();
        return await FinishAsync(item, pageToken, session, cancellationToken);
    }

    /// <summary>
    /// Un «finish» anterior no cerró. Según lo que diga Facebook del video:
    /// publicado o programado → seguir consultando; subido sin publicar → se termina ahora; inexistente o con
    /// error → null (se sube de nuevo).
    /// </summary>
    public override async Task<PublishStep?> VerifyAsync(PublicationDueItem item, CancellationToken cancellationToken)
    {
        if (item.PostKind != PostKinds.Video) return await VerifyFeedAsync(item, cancellationToken);

        Session? session = ReadSession<Session>(item.SessionData);
        if (session is null) return UnverifiableStep();

        string? pageToken = await TokenAsync(item.ConnectionKey, cancellationToken);
        if (pageToken is null) return NoTokenStep(Account);

        var result = await graph.VideoStatusAsync(session.VideoId, pageToken, cancellationToken);
        if (!result.Ok) return UnverifiableStep();

        var status = result.Data!;
        if (status.IsFailed) return null;

        return status.IsPublished
            ? PublishStep.Processing(session.VideoId, VideoUrl(item.AccountExternalId, session.VideoId))
            : await FinishAsync(item, pageToken, session, cancellationToken);
    }

    private async Task<PublishStep> FinishAsync(PublicationDueItem item, string pageToken, Session session, CancellationToken cancellationToken)
    {
        var finished = await graph.FinishUploadAsync(item.AccountExternalId, pageToken, session.SessionId, item.Title, item.Description, item.PublishAt, cancellationToken);
        if (!finished.Ok) return MetaErrorClassifier.Classify(finished.Error!);
        if (!finished.Data) return PublishStep.Retry("FINISH", "Facebook no confirmó el cierre de la subida. Se reintenta solo.");

        return PublishStep.Processing(session.VideoId, VideoUrl(item.AccountExternalId, session.VideoId));
    }

    private static string VideoUrl(string pageId, string videoId) => $"https://www.facebook.com/{pageId}/videos/{videoId}";

    private static string PostUrl(string postId) => $"https://www.facebook.com/{postId}";

    /// <summary>Texto, enlace o fotos al muro. Programado: Facebook lo publica a la hora (published=false).</summary>
    private async Task<PublishStep> FeedAsync(PublicationDueItem item, string pageToken, string leaseOwner, UploadHeartbeat heartbeat)
    {
        CancellationToken cancellationToken = heartbeat.Token;
        DateTimeOffset? publishAt = item.PublishAt is { } at && at > DateTimeOffset.UtcNow ? at : null;
        var session = ReadSession<PostSession>(item.SessionData) ?? new PostSession();

        var photoIds = new List<string>();
        foreach (var media in item.Media)
        {
            if (!session.Photos.TryGetValue(media.Id, out string? photoId))
            {
                var uploaded = await graph.UploadUnpublishedPhotoAsync(item.AccountExternalId, pageToken, media.FullPath, media.ContentType, publishAt != null, cancellationToken);
                if (!uploaded.Ok) return heartbeat.LeaseLost ? PublishStep.LeaseLost() : MetaErrorClassifier.Classify(uploaded.Error!);
                photoId = uploaded.Data!;
                session.Photos[media.Id] = photoId;
                await SaveSessionAsync(item, leaseOwner, session, cancellationToken);
            }
            photoIds.Add(photoId);
            heartbeat.Report(photoIds.Count, Math.Max(item.Media.Count, 1));
        }

        await heartbeat.MarkCommittingAsync();
        var posted = await graph.FeedPostAsync(item.AccountExternalId, pageToken, PostText(item), item.PostKind == PostKinds.Link ? item.LinkUrl : null,
            photoIds, publishAt, cancellationToken);
        if (!posted.Ok) return MetaErrorClassifier.Classify(posted.Error!);

        return PublishStep.Done(PostUrl(posted.Data!), publishAt != null ? "Programada en Facebook: se publicará a la hora indicada." : null, posted.Data);
    }

    /// <summary>Busca en el muro un post con el mismo texto creado desde que empezó el envío. Programados: no se pueden ver.</summary>
    private async Task<PublishStep?> VerifyFeedAsync(PublicationDueItem item, CancellationToken cancellationToken)
    {
        if (item.PublishAt is { } at && at > DateTimeOffset.UtcNow) return UnverifiableStep();

        string? pageToken = await TokenAsync(item.ConnectionKey, cancellationToken);
        if (pageToken is null) return NoTokenStep(Account);

        var recent = await graph.RecentFeedAsync(item.AccountExternalId, pageToken, cancellationToken);
        if (!recent.Ok) return UnverifiableStep();

        var since = VerifySince(item);
        string message = PostText(item);
        var match = recent.Data!.FirstOrDefault(p => p.CreatedAt >= since && p.Message == message);
        return match.Id is { Length: > 0 } ? PublishStep.Done(PostUrl(match.Id), externalId: match.Id) : null;
    }

    /// <summary>El texto del post: la descripción o, si está vacía, el título.</summary>
    public async Task<CommentResult> CommentAsync(CommentRequest request, CancellationToken cancellationToken)
    {
        string? pageToken = await TokenAsync(request.ConnectionKey, cancellationToken);
        if (pageToken is null) return CommentResult.Fail("la Página no tiene un acceso válido; vuelve a conectarla.");

        var result = await graph.CommentAsync(request.PostExternalId, pageToken, request.Text, cancellationToken);
        return result.Ok ? CommentResult.Ok(result.Data!) : CommentResult.Fail(CommentError(result.Error!));
    }

    /// <summary>Sin el permiso pages_manage_engagement Meta responde #200/#10: se explica qué falta.</summary>
    internal static string CommentError(MetaError error) => error.Code is 10 or 200 or 3
        ? "falta el permiso para comentar (pages_manage_engagement en Facebook, instagram_manage_comments en Instagram). Añádelo al token del usuario del sistema (ver la guía)."
        : MetaErrorClassifier.Friendly(error);

    private static bool IsInvalidOffset(MetaError error) =>
        error.Code == MetaErrorClassifier.InvalidOffset || error.Subcode == MetaErrorClassifier.InvalidOffset;

    /// <summary>error_data puede venir como objeto o como texto JSON.</summary>
    private static bool TryReadOffsets(MetaError error, out long start, out long end)
    {
        start = end = 0;
        if (error.Data is not { } data) return false;

        try
        {
            JsonElement element = data.ValueKind == JsonValueKind.String
                ? JsonDocument.Parse(data.GetString() ?? "{}").RootElement
                : data;
            start = MetaGraphClient.ReadLong(element, "start_offset");
            end = MetaGraphClient.ReadLong(element, "end_offset");
            return end > start;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
