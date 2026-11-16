using System.Text.Json;
using Google;
using Google.Apis.YouTube.v3;
using Google.Apis.YouTube.v3.Data;
using YoutubeMeta.Api.Application.Inbox;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Infrastructure.External.YouTube;

/// <summary>
/// Comentarios de los videos del canal. YouTube no avisa: se consultan cada pocos minutos con commentThreads.list
/// (1 unidad por página, del mismo cupo diario que las subidas). Cada hilo se guarda en crudo con la forma propia de
/// <see cref="ThreadPayload"/>; responder (comments.insert) cuesta 50 unidades. Necesita el permiso youtube.force-ssl.
/// </summary>
public sealed class YoutubeInbox(InboxChannelServices services, YoutubeClientFactory clients, ActivityRepository activity, ILogger<YoutubeInbox> logger)
    : InboxChannelBase(services)
{
    private const int MaxPages = 3;
    private const int MaxReplyFetches = 5;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public override string Platform => Platforms.YouTube;

    public override InboxAccountStatus Inspect(InboxAccountRow account, InboxEnvironment environment) =>
        MissingScope(account, YouTubeService.Scope.YoutubeForceSsl) is null
            ? new(false, true, InboxModes.Poll)
            : new(false, true, InboxModes.Poll, "Falta el permiso para leer y responder comentarios. Vuelve a conectar el canal (una sola vez).", InboxFixes.Reconnect);

    public override async Task<InboxPollResult> PollAsync(InboxAccountRow account, InboxEnvironment environment, CancellationToken cancellationToken)
    {
        DateTime now = TimeClock.UtcNow;
        DateTime next = now.AddMinutes(Math.Max(environment.Settings.YoutubePollMinutes, 5));
        DateTimeOffset? since = DateTimeOffset.TryParse(account.SyncCursor, out var parsed) ? parsed : null;

        try
        {
            using var youtube = await clients.CreateAsync(account.ConnectionKey, TimeSpan.FromSeconds(60), cancellationToken);
            if (youtube is null) return InboxPollResult.Failed(account.SyncCursor, now.AddHours(1), "El canal no tiene un acceso válido. Vuelve a conectarlo.");

            var threads = new List<CommentThread>();
            string? pageToken = null;
            for (int page = 0; page < MaxPages; page++)
            {
                var request = youtube.CommentThreads.List("snippet,replies");
                request.AllThreadsRelatedToChannelId = account.ExternalId;
                request.MaxResults = 50;
                request.TextFormat = CommentThreadsResource.ListRequest.TextFormatEnum.PlainText;
                request.PageToken = pageToken;
                var response = await request.ExecuteAsync(cancellationToken);
                await activity.QuotaAdd(QuotaBuckets.General, Domain.Rules.InboxRules.YoutubeListUnits, account.Id, CancellationToken.None);

                var items = response.Items ?? [];
                threads.AddRange(items);
                pageToken = response.NextPageToken;
                // La primera vez basta con lo más reciente; después, hasta llegar a lo ya visto.
                if (since is null || pageToken is null || items.Any(t => Updated(t) <= since)) break;
            }

            var fresh = threads.Where(t => since is null || Updated(t) > since).ToList();
            if (fresh.Count == 0) return InboxPollResult.Idle(account.SyncCursor, next);

            var titles = await TitlesAsync(youtube, fresh.Select(t => t.Snippet.VideoId).Where(id => id is not null).Distinct().ToList(), account.Id, cancellationToken);
            int fetches = 0;
            var events = new List<InboxRawEvent>();
            foreach (var thread in fresh)
            {
                var replies = thread.Replies?.Comments?.ToList() ?? [];
                if (thread.Snippet.TotalReplyCount > replies.Count && fetches++ < MaxReplyFetches)
                    replies = await RepliesAsync(youtube, thread.Id, account.Id, cancellationToken);

                var payload = new ThreadPayload(thread.Snippet.VideoId ?? string.Empty, titles.GetValueOrDefault(thread.Snippet.VideoId ?? string.Empty),
                    [Read(thread.Snippet.TopLevelComment, null), .. replies.Select(r => Read(r, thread.Id))]);
                events.Add(new InboxRawEvent($"YT:{account.Id}:{thread.Id}:{Updated(thread):yyyyMMddHHmmss}:{payload.Comments.Count}",
                    JsonSerializer.Serialize(payload, Json)));
            }

            return new InboxPollResult(events, threads.Max(Updated).ToString("O"), next);
        }
        catch (Exception ex) when (ex is GoogleApiException or HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            var step = YoutubeErrorClassifier.Classify(ex);
            logger.LogWarning("Comentarios de YouTube de «{Name}»: {Message}", account.Name, step.Message);
            return InboxPollResult.Failed(account.SyncCursor, step.NextAttemptAt ?? next, step.Message ?? "YouTube no respondió.");
        }
    }

    public override Task<IReadOnlyList<InboxUpdate>> ParseAsync(InboxEventRow inboxEvent, IReadOnlyList<InboxAccountRow> accounts, CancellationToken cancellationToken)
    {
        var account = AccountFromKey(accounts, inboxEvent.EventKey);
        var payload = JsonSerializer.Deserialize<ThreadPayload>(inboxEvent.Payload, Json);
        return Task.FromResult(account is null || payload is null || !account.InboxComments ? [] : ToUpdates(payload, account));
    }

    /// <summary>Un hilo guardado → un mensaje por comentario (los del propio canal cuentan como respuestas propias).</summary>
    public static IReadOnlyList<InboxUpdate> ToUpdates(ThreadPayload payload, InboxAccountRow account) =>
        payload.VideoId.Length == 0 ? [] : payload.Comments.Select(c => (InboxUpdate)new InboxIncoming(
            account.Id, InboxKinds.Comments, payload.VideoId, payload.VideoTitle ?? "Video de YouTube", c.Id,
            c.AuthorChannelId == account.ExternalId ? InboxDirections.Out : InboxDirections.In,
            c.PublishedAt, c.Text,
            AuthorName: c.Author, AuthorExternalId: c.AuthorChannelId, ParentExternalId: c.ParentId,
            Link: $"https://youtu.be/{payload.VideoId}", PublicationExternalId: payload.VideoId)).ToList();

    /// <summary>Responde a un comentario (comments.insert) o, sin comentario elegido, comenta el video (commentThreads.insert).</summary>
    public override async Task<PublishStep> SendAsync(InboxSendContext context, CancellationToken cancellationToken)
    {
        var item = context.Item;
        try
        {
            using var youtube = await clients.CreateAsync(item.ConnectionKey, TimeSpan.FromSeconds(60), cancellationToken);
            if (youtube is null) return NoTokenStep(item.AccountName);

            string text = item.Body?.Trim() ?? string.Empty;
            string id;
            if (item.ParentExternalId is { } parent)
            {
                // Las respuestas solo cuelgan del comentario principal: «hilo.respuesta» → «hilo».
                var reply = await youtube.Comments.Insert(new Comment
                {
                    Snippet = new CommentSnippet { ParentId = parent.Split('.')[0], TextOriginal = text }
                }, "snippet").ExecuteAsync(cancellationToken);
                id = reply.Id;
            }
            else
            {
                var thread = await youtube.CommentThreads.Insert(new CommentThread
                {
                    Snippet = new CommentThreadSnippet
                    {
                        VideoId = item.ConversationExternalId,
                        TopLevelComment = new Comment { Snippet = new CommentSnippet { TextOriginal = text } }
                    }
                }, "snippet").ExecuteAsync(cancellationToken);
                id = thread.Snippet.TopLevelComment.Id;
            }
            await activity.QuotaAdd(QuotaBuckets.General, Domain.Rules.InboxRules.YoutubeReplyUnits, item.ConnectionId, CancellationToken.None);
            return PublishStep.Done(null, externalId: id);
        }
        catch (Exception ex) when (ex is GoogleApiException or HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            return YoutubeErrorClassifier.Classify(ex);
        }
    }

    private async Task<Dictionary<string, string>> TitlesAsync(YouTubeService youtube, List<string> videoIds, int connectionId, CancellationToken cancellationToken)
    {
        var titles = new Dictionary<string, string>();
        foreach (var chunk in videoIds.Chunk(50))
        {
            var request = youtube.Videos.List("snippet");
            request.Id = string.Join(',', chunk);
            var response = await request.ExecuteAsync(cancellationToken);
            await activity.QuotaAdd(QuotaBuckets.General, Domain.Rules.InboxRules.YoutubeListUnits, connectionId, CancellationToken.None);
            foreach (var video in response.Items ?? []) titles[video.Id] = video.Snippet.Title;
        }
        return titles;
    }

    private async Task<List<Comment>> RepliesAsync(YouTubeService youtube, string parentId, int connectionId, CancellationToken cancellationToken)
    {
        var request = youtube.Comments.List("snippet");
        request.ParentId = parentId;
        request.MaxResults = 100;
        request.TextFormat = CommentsResource.ListRequest.TextFormatEnum.PlainText;
        var response = await request.ExecuteAsync(cancellationToken);
        await activity.QuotaAdd(QuotaBuckets.General, Domain.Rules.InboxRules.YoutubeListUnits, connectionId, CancellationToken.None);
        return response.Items?.ToList() ?? [];
    }

    /// <summary>Última actividad del hilo: el comentario principal o su respuesta más nueva.</summary>
    private static DateTimeOffset Updated(CommentThread thread) =>
        new[] { thread.Snippet.TopLevelComment?.Snippet?.UpdatedAtDateTimeOffset }
            .Concat(thread.Replies?.Comments?.Select(r => r.Snippet?.UpdatedAtDateTimeOffset) ?? [])
            .Max() ?? DateTimeOffset.MinValue;

    private static CommentPayload Read(Comment comment, string? parentId) => new(
        comment.Id,
        parentId ?? comment.Snippet.ParentId,
        comment.Snippet.AuthorDisplayName,
        comment.Snippet.AuthorChannelId?.Value,
        comment.Snippet.TextOriginal ?? comment.Snippet.TextDisplay ?? string.Empty,
        comment.Snippet.PublishedAtDateTimeOffset?.UtcDateTime ?? TimeClock.UtcNow);

    /// <summary>Un hilo de comentarios tal como se guarda en Inbox_Events.</summary>
    public sealed record ThreadPayload(string VideoId, string? VideoTitle, IReadOnlyList<CommentPayload> Comments);

    public sealed record CommentPayload(string Id, string? ParentId, string? Author, string? AuthorChannelId, string Text, DateTime PublishedAt);
}
