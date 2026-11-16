using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Caching.Memory;
using YoutubeMeta.Api.Application.Inbox;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Domain.Rules;

namespace YoutubeMeta.Api.Infrastructure.External.Meta;

/// <summary>
/// Bandeja de Facebook e Instagram: los dos llegan por el webhook de la app de Meta con el mismo formato
/// (entry.messaging = mensajes privados; entry.changes = comentarios) y responden por la Página (Messenger).
/// Lo que cambia entre ambos (permisos, campo de comentarios, cómo se responde a un comentario) va en cada subclase.
/// </summary>
public abstract class MetaInboxBase(InboxChannelServices services, MetaGraphClient graph, IMemoryCache cache) : InboxChannelBase(services)
{
    private static readonly TimeSpan ProfileLifetime = TimeSpan.FromDays(1);
    private static readonly TimeSpan PageLifetime = TimeSpan.FromHours(1);

    protected MetaGraphClient Graph { get; } = graph;

    /// <summary>Permisos para leer y responder mensajes privados y comentarios.</summary>
    protected abstract string[] RequiredScopes { get; }

    protected abstract string SubscribedFields { get; }

    protected abstract bool IsInstagram { get; }

    /// <summary>Un cambio de entry.changes → comentario normalizado (o null si no es un comentario nuevo).</summary>
    protected abstract InboxIncoming? ParseComment(InboxAccountRow account, JsonElement change, DateTime entryTime);

    /// <summary>Responde en público a un comentario (o a la publicación si no se eligió comentario).</summary>
    protected abstract Task<MetaResult<string>> ReplyCommentAsync(PageAccess access, InboxSendItem item, string text, CancellationToken cancellationToken);

    /// <summary>Página por la que salen los mensajes y su token (Instagram: la vinculada a la cuenta).</summary>
    protected abstract Task<PageAccess?> PageAccessAsync(string connectionKey, string accountExternalId, CancellationToken cancellationToken);

    public override InboxAccountStatus Inspect(InboxAccountRow account, InboxEnvironment environment)
    {
        if (MetaWebhookProblem(environment) is { } server) return new(true, true, InboxModes.Webhook, server.Problem, server.Fix);
        if (MissingScope(account, RequiredScopes) is { } scope)
            return new(true, true, InboxModes.Webhook,
                $"Al token le falta el permiso {scope} para leer y responder. Genera el token de nuevo con los permisos de la guía y vuelve a conectar.",
                InboxFixes.Reconnect);
        return new(true, true, InboxModes.Webhook);
    }

    public override async Task<string?> PrepareAsync(InboxAccountRow account, InboxEnvironment environment, CancellationToken cancellationToken)
    {
        if (MetaWebhookProblem(environment) is { } server) return server.Problem;
        var access = await PageAccessAsync(account.ConnectionKey, account.ExternalId, cancellationToken);
        if (access is null) return $"{account.Name} no tiene un acceso válido. Vuelve a conectarla en Conexiones.";

        var subscribed = await Graph.SubscribeAppAsync(access.PageId, access.PageToken, SubscribedFields, cancellationToken);
        return subscribed.Ok ? null : $"No se pudo suscribir la Página a los avisos: {MetaErrorClassifier.Friendly(subscribed.Error!)}";
    }

    public override async Task<IReadOnlyList<InboxUpdate>> ParseAsync(InboxEventRow inboxEvent, IReadOnlyList<InboxAccountRow> accounts, CancellationToken cancellationToken)
    {
        using var document = JsonDocument.Parse(inboxEvent.Payload);
        var entry = document.RootElement;
        if (Text(entry, "id") is not { } accountId || AccountFor(accounts, accountId) is not { } account) return [];

        var updates = new List<InboxUpdate>();
        DateTime entryTime = EntryTime(entry);

        foreach (var item in Items(entry, "messaging"))
        {
            // Abrió el chat con un enlace de invitación (m.me/pagina?ref=código): va antes que su mensaje.
            if (account.InboxDirect && InviteCode(item) is { } code && Text(Child(item, "sender"), "id") is { } person && person != account.ExternalId)
                updates.Add(new InboxReferral(account.Id, person, code));

            if (Child(item, "message") is { ValueKind: JsonValueKind.Object } message && account.InboxDirect)
            {
                if (Child(message, "is_deleted").ValueKind == JsonValueKind.True || Text(message, "mid") is not { } mid) continue;
                string sender = Text(Child(item, "sender"), "id") ?? string.Empty;
                bool echo = Child(message, "is_echo").ValueKind == JsonValueKind.True || sender == account.ExternalId;
                string customer = echo ? Text(Child(item, "recipient"), "id") ?? string.Empty : sender;
                if (customer.Length == 0) continue;

                var contact = await ContactAsync(account, customer, cancellationToken);
                updates.Add(new InboxIncoming(account.Id, InboxKinds.Direct, customer, contact.Name, mid,
                    echo ? InboxDirections.Out : InboxDirections.In,
                    long.TryParse(Text(item, "timestamp"), out long ms) ? DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime : entryTime,
                    Text(message, "text"), contact,
                    AuthorName: echo ? account.Name : contact.Name, AuthorExternalId: sender,
                    ParentExternalId: Text(Child(message, "reply_to"), "mid"))
                {
                    Attachments = Items(message, "attachments").Select(ReadAttachment).ToList()
                });
            }

            foreach (var delivered in Items(Child(item, "delivery"), "mids"))
                if (delivered.GetString() is { } deliveredId) updates.Add(new InboxStatusChange(deliveredId, InboxMessageStatus.Delivered));
        }

        if (account.InboxComments)
            foreach (var change in Items(entry, "changes"))
                if (ParseComment(account, change, entryTime) is { } comment) updates.Add(comment);

        return updates;
    }

    public override async Task<PublishStep> SendAsync(InboxSendContext context, CancellationToken cancellationToken)
    {
        var item = context.Item;
        var access = await PageAccessAsync(item.ConnectionKey, item.AccountExternalId, cancellationToken);
        if (access is null) return NoTokenStep(item.AccountName);

        var options = item.SendOptions;
        string text = item.Body?.Trim() ?? string.Empty;

        if (item.Kind == InboxKinds.Comments && !options.PrivateReply)
        {
            var reply = await ReplyCommentAsync(access, item, text, cancellationToken);
            return reply.Ok ? PublishStep.Done(null, externalId: reply.Data) : MetaErrorClassifier.Classify(reply.Error!);
        }

        // Mensaje privado (o respuesta privada a un comentario): sale por la Página.
        if (item.Kind == InboxKinds.Direct && context.Window == InboxWindowState.Closed) return WindowClosedStep(Label);
        string? tag = item.Kind == InboxKinds.Direct && context.Window == InboxWindowState.HumanAgent ? "HUMAN_AGENT" : null;
        var recipient = options.PrivateReply
            ? new JsonObject { ["comment_id"] = item.ParentExternalId }
            : new JsonObject { ["id"] = item.ConversationExternalId };

        string? lastId = null;
        foreach (var media in context.Media)
        {
            var attachment = new JsonObject
            {
                ["attachment"] = new JsonObject
                {
                    ["type"] = media.MediaKind switch { MediaKinds.Image => "image", MediaKinds.Video => "video", _ => "file" },
                    ["payload"] = new JsonObject { ["url"] = media.PublicUrl, ["is_reusable"] = false }
                }
            };
            var sent = await Graph.SendMessageAsync(access.PageId, access.PageToken, recipient.DeepClone().AsObject(), attachment, tag, cancellationToken);
            if (!sent.Ok) return MetaErrorClassifier.Classify(sent.Error!);
            lastId = sent.Data;
        }

        if (text.Length > 0)
        {
            var sent = await Graph.SendMessageAsync(access.PageId, access.PageToken, recipient, new JsonObject { ["text"] = text }, tag, cancellationToken);
            if (!sent.Ok) return MetaErrorClassifier.Classify(sent.Error!);
            lastId = sent.Data;
        }
        return PublishStep.Done(null, externalId: lastId);
    }

    /// <summary>Nombre y foto de quien escribe (una consulta al día por persona; si Meta no los da, solo el id).</summary>
    private async Task<InboxContact> ContactAsync(InboxAccountRow account, string userId, CancellationToken cancellationToken)
    {
        string key = $"inbox:profile:{Platform}:{userId}";
        if (cache.TryGetValue(key, out InboxContact? cached) && cached is not null) return cached;

        InboxContact contact = new(userId, null);
        if (await PageAccessAsync(account.ConnectionKey, account.ExternalId, cancellationToken) is { } access
            && await Graph.ProfileAsync(userId, access.PageToken, IsInstagram, cancellationToken) is { } profile)
            contact = new InboxContact(userId, profile.Name, profile.Handle, profile.PictureUrl);

        cache.Set(key, contact, ProfileLifetime);
        return contact;
    }

    /// <summary>Página y token cacheados una hora (Instagram necesita una consulta para saber cuál es su Página).</summary>
    protected async Task<PageAccess?> CachedPageAccessAsync(string connectionKey, Func<Task<PageAccess?>> load)
    {
        string key = $"inbox:page:{connectionKey}";
        if (cache.TryGetValue(key, out PageAccess? cached) && cached is not null) return cached;
        var access = await load();
        if (access is not null) cache.Set(key, access, PageLifetime);
        return access;
    }

    /// <summary>
    /// Código de invitación de un aviso: llega como «referral» suelto (chat ya abierto), dentro del «postback» del botón
    /// Empezar o dentro del primer mensaje. Solo cuenta si es uno de nuestros códigos.
    /// </summary>
    public static string? InviteCode(JsonElement item)
    {
        foreach (var referral in new[] { Child(item, "referral"), Child(Child(item, "postback"), "referral"), Child(Child(item, "message"), "referral") })
            if (Text(referral, "ref") is { } code && InboxAgenda.IsInviteCode(code)) return code;
        return null;
    }

    private static DateTime EntryTime(JsonElement entry)
    {
        if (!long.TryParse(Text(entry, "time"), out long value)) return TimeClock.UtcNow;
        // Meta manda segundos en los cambios y milisegundos en messaging.
        return value > 100_000_000_000 ? DateTimeOffset.FromUnixTimeMilliseconds(value).UtcDateTime : DateTimeOffset.FromUnixTimeSeconds(value).UtcDateTime;
    }

    private static InboxAttachment ReadAttachment(JsonElement attachment) => new()
    {
        Kind = Text(attachment, "type") switch
        {
            "image" => "image",
            "video" => "video",
            "audio" => "audio",
            "file" => "document",
            "sticker" => "sticker",
            _ => "other"
        },
        Url = Text(Child(attachment, "payload"), "url"),
        Name = Text(Child(attachment, "payload"), "title")
    };

    /// <param name="AccountToken">Token guardado en la cuenta (Instagram: el del usuario del sistema).</param>
    public sealed record PageAccess(string PageId, string PageToken, string AccountToken);
}

/// <summary>Messenger de la Página y comentarios de sus publicaciones (campo «feed» del webhook).</summary>
public sealed class FacebookInbox(InboxChannelServices services, MetaGraphClient graph, IMemoryCache cache) : MetaInboxBase(services, graph, cache)
{
    public override string Platform => Platforms.Facebook;

    protected override string[] RequiredScopes => ["pages_messaging", "pages_manage_metadata", "pages_read_user_content", "pages_manage_engagement"];

    /// <summary>messaging_referrals y messaging_postbacks traen el código de las invitaciones (m.me/pagina?ref=…).</summary>
    protected override string SubscribedFields => "messages,message_echoes,message_deliveries,messaging_postbacks,messaging_referrals,feed";

    protected override bool IsInstagram => false;

    public override Task<string?> InviteLinkAsync(InboxAccountRow account, string code, CancellationToken cancellationToken) =>
        Task.FromResult<string?>($"https://m.me/{account.ExternalId}?ref={code}");

    protected override Task<PageAccess?> PageAccessAsync(string connectionKey, string accountExternalId, CancellationToken cancellationToken) =>
        CachedPageAccessAsync(connectionKey, async () =>
            await TokenAsync(connectionKey, cancellationToken) is { } token ? new PageAccess(accountExternalId, token, token) : null);

    protected override InboxIncoming? ParseComment(InboxAccountRow account, JsonElement change, DateTime entryTime)
    {
        var value = Child(change, "value");
        if (Text(change, "field") != "feed" || Text(value, "item") != "comment" || Text(value, "verb") != "add") return null;
        if (Text(value, "comment_id") is not { } commentId || Text(value, "post_id") is not { } postId) return null;

        var from = Child(value, "from");
        string? parent = Text(value, "parent_id");
        return new InboxIncoming(account.Id, InboxKinds.Comments, postId, "Publicación de Facebook", commentId,
            Text(from, "id") == account.ExternalId ? InboxDirections.Out : InboxDirections.In,
            UnixSeconds(value, "created_time", entryTime), Text(value, "message"),
            AuthorName: Text(from, "name"), AuthorExternalId: Text(from, "id"),
            ParentExternalId: parent == postId ? null : parent,
            Link: $"https://www.facebook.com/{postId}", PublicationExternalId: postId);
    }

    protected override Task<MetaResult<string>> ReplyCommentAsync(PageAccess access, InboxSendItem item, string text, CancellationToken cancellationToken) =>
        Graph.CommentAsync(item.ParentExternalId ?? item.ConversationExternalId, access.PageToken, text, cancellationToken);
}

/// <summary>Mensajes directos de la cuenta profesional y comentarios de sus publicaciones (campo «comments»).</summary>
public sealed class InstagramInbox(InboxChannelServices services, MetaGraphClient graph, IMemoryCache cache) : MetaInboxBase(services, graph, cache)
{
    public override string Platform => Platforms.Instagram;

    protected override string[] RequiredScopes => ["instagram_manage_messages", "instagram_manage_comments", "pages_messaging"];

    protected override string SubscribedFields => "messages,message_echoes,message_deliveries";

    protected override bool IsInstagram => true;

    /// <summary>
    /// ig.me/m/&lt;cuenta&gt;?ref=código. Si Instagram no devuelve la referencia, el chat llega igual y se vincula a mano.
    /// </summary>
    public override Task<string?> InviteLinkAsync(InboxAccountRow account, string code, CancellationToken cancellationToken) =>
        Task.FromResult(Username(account.AccountHint) is { } username ? $"https://ig.me/m/{username}?ref={code}" : null);

    /// <summary>Usuario de la cuenta a partir de la pista guardada al conectar: «@usuario · Página» → «usuario».</summary>
    public static string? Username(string? accountHint) =>
        accountHint?.Trim() is ['@', ..] hint && hint[1..].Split(' ', 2)[0] is { Length: > 0 } username ? username : null;

    protected override Task<PageAccess?> PageAccessAsync(string connectionKey, string accountExternalId, CancellationToken cancellationToken) =>
        CachedPageAccessAsync(connectionKey, async () =>
        {
            if (await TokenAsync(connectionKey, cancellationToken) is not { } token) return null;
            var page = await Graph.PageForInstagramAsync(accountExternalId, token, cancellationToken);
            return page.Ok ? new PageAccess(page.Data!.Id, page.Data.AccessToken!, token) : null;
        });

    protected override InboxIncoming? ParseComment(InboxAccountRow account, JsonElement change, DateTime entryTime)
    {
        var value = Child(change, "value");
        if (Text(change, "field") != "comments" || Text(value, "id") is not { } commentId || Text(Child(value, "media"), "id") is not { } mediaId) return null;

        var from = Child(value, "from");
        return new InboxIncoming(account.Id, InboxKinds.Comments, mediaId, "Publicación de Instagram", commentId,
            Text(from, "id") == account.ExternalId ? InboxDirections.Out : InboxDirections.In,
            entryTime, Text(value, "text"),
            AuthorName: Text(from, "username") is { } user ? $"@{user}" : null, AuthorExternalId: Text(from, "id"),
            ParentExternalId: Text(value, "parent_id"), PublicationExternalId: mediaId);
    }

    /// <summary>Instagram: «replies» de un comentario o, sin comentario elegido, un comentario nuevo en la publicación.</summary>
    protected override Task<MetaResult<string>> ReplyCommentAsync(PageAccess access, InboxSendItem item, string text, CancellationToken cancellationToken) =>
        item.ParentExternalId is { } parent
            ? Graph.CommentAsync(parent, access.AccountToken, text, cancellationToken, "replies")
            : Graph.CommentAsync(item.ConversationExternalId, access.AccountToken, text, cancellationToken);
}
