using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using YoutubeMeta.Api.Application.Inbox;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Infrastructure.External.Teams;

/// <summary>
/// Respuestas en los hilos de lo que la app publicó en canales de Teams (una conversación por publicación). Se consultan
/// cada pocos minutos con Graph; necesita ChannelMessage.Read.All, que aprueba un administrador. Los canales conectados por
/// webhook de Workflows no sirven: ese camino solo envía.
/// </summary>
public sealed partial class TeamsInbox(InboxChannelServices services, TeamsClient teams, TeamsTokens tokens, InboxRepository inbox)
    : InboxChannelBase(services)
{
    public override string Platform => Platforms.Teams;

    public override InboxAccountStatus Inspect(InboxAccountRow account, InboxEnvironment environment)
    {
        if (Platforms.IsTeamsWebhook(account.Platform, account.ExternalId))
            return new(false, true, InboxModes.None, "Este canal está conectado por webhook, que solo envía. Para leer las respuestas conéctalo con Microsoft (Graph).",
                InboxFixes.Guide);
        return account.HasScope(TeamsClient.ReadScope)
            ? new(false, true, InboxModes.Poll)
            : new(false, true, InboxModes.Poll,
                "Falta el permiso para leer las respuestas. Vuelve a conectar Teams marcando «Leer respuestas» (lo aprueba un administrador de tu organización).",
                InboxFixes.Reconnect);
    }

    public override async Task<InboxPollResult> PollAsync(InboxAccountRow account, InboxEnvironment environment, CancellationToken cancellationToken)
    {
        DateTime now = TimeClock.UtcNow;
        DateTime next = now.AddMinutes(Math.Max(environment.Settings.TeamsPollMinutes, 1));
        var access = await tokens.AccessAsync(account.ConnectionKey, cancellationToken);
        if (access.Token is not { } token) return InboxPollResult.Failed(account.SyncCursor, access.IsTransient ? next : now.AddHours(1), access.Problem!);

        var (teamId, channelId) = TeamsPublisher.Split(account.ExternalId);
        var events = new List<InboxRawEvent>();
        foreach (var publication in await inbox.PublicationsRecent(account.Id, now.AddDays(-Math.Max(environment.Settings.TeamsThreadDays, 1)), cancellationToken))
        {
            var replies = await teams.RepliesAsync(token, teamId, channelId, publication.ExternalId, cancellationToken);
            if (!replies.Ok)
            {
                if (replies.Error!.HttpStatus is 401 or 403) return InboxPollResult.Failed(account.SyncCursor, now.AddHours(1), TeamsPublisher.Classify(replies.Error).Message!);
                continue;
            }
            foreach (var reply in replies.Data!)
                if (Text(reply, "id") is { } id)
                    events.Add(new InboxRawEvent($"TEAMS:{account.Id}:{id}:{Text(reply, "lastModifiedDateTime")}", JsonSerializer.Serialize(new
                    {
                        publication.ExternalId,
                        publication.Title,
                        publication.ExternalUrl,
                        Reply = reply
                    })));
        }
        return new InboxPollResult(events, account.SyncCursor, next);
    }

    public override Task<IReadOnlyList<InboxUpdate>> ParseAsync(InboxEventRow inboxEvent, IReadOnlyList<InboxAccountRow> accounts, CancellationToken cancellationToken)
    {
        var account = AccountFromKey(accounts, inboxEvent.EventKey);
        using var document = JsonDocument.Parse(inboxEvent.Payload);
        var root = document.RootElement;
        var reply = Child(root, "Reply");
        if (account is null || !account.InboxComments || Text(root, "ExternalId") is not { } messageId || Text(reply, "id") is not { } id
            || Child(reply, "deletedDateTime").ValueKind == JsonValueKind.String)
            return Task.FromResult<IReadOnlyList<InboxUpdate>>([]);

        var user = Child(Child(reply, "from"), "user");
        var body = Child(reply, "body");
        string? content = Text(body, "content");
        string? text = Text(body, "contentType") == "html" ? PlainText(content) : content;
        // Lo que escribe quien conectó el canal (desde Teams o desde la app) cuenta como respuesta propia.
        bool own = Text(user, "id") is { } userId && userId == ConnectionExtra.Parse(account.Extra).UserId;

        IReadOnlyList<InboxUpdate> updates =
        [
            new InboxIncoming(account.Id, InboxKinds.Comments, messageId, Text(root, "Title"), id, own ? InboxDirections.Out : InboxDirections.In,
                DateTime.TryParse(Text(reply, "createdDateTime"), null, System.Globalization.DateTimeStyles.AdjustToUniversal, out var at) ? at : TimeClock.UtcNow,
                text, AuthorName: Text(user, "displayName"), AuthorExternalId: Text(user, "id"),
                Link: Text(root, "ExternalUrl"), PublicationExternalId: messageId)
        ];
        return Task.FromResult(updates);
    }

    public override async Task<PublishStep> SendAsync(InboxSendContext context, CancellationToken cancellationToken)
    {
        var item = context.Item;
        var access = await tokens.AccessAsync(item.ConnectionKey, cancellationToken);
        if (access.Token is not { } token)
            return access.IsTransient ? PublishStep.Retry("TEAMS_TOKEN", access.Problem!) : PublishStep.NeedsReconnect("TEAMS_TOKEN", access.Problem!);

        var (teamId, channelId) = TeamsPublisher.Split(item.AccountExternalId);
        var reply = await teams.ReplyAsync(token, teamId, channelId, item.ConversationExternalId, TeamsPublisher.Paragraphs(item.Body), cancellationToken);
        return reply.Ok ? PublishStep.Done(null, externalId: reply.Data) : TeamsPublisher.Classify(reply.Error!);
    }

    /// <summary>HTML de Teams → texto: saltos de línea donde había párrafos y sin etiquetas.</summary>
    public static string? PlainText(string? html)
    {
        if (string.IsNullOrEmpty(html)) return html;
        string text = BreakTags().Replace(html, "\n");
        text = AnyTag().Replace(text, string.Empty);
        return WebUtility.HtmlDecode(text).Trim();
    }

    [GeneratedRegex(@"<\s*(br|/p|/div)\s*/?>", RegexOptions.IgnoreCase)]
    private static partial Regex BreakTags();

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex AnyTag();
}
