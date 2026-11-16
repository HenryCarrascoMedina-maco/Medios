using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Application.Services;

namespace YoutubeMeta.Api.Infrastructure.External.Teams;

/// <summary>
/// Publica en un canal de Teams.
/// <list type="bullet">
/// <item>Graph: mensaje con asunto (el título) y texto con formato. Las imágenes van dentro del mensaje si caben
/// (hostedContents) y, si no, como archivos; video y PDF se suben a «Archivos» del canal y se adjuntan. Lo subido se
/// guarda en la sesión para no repetirlo. Primer comentario = respuesta en el hilo.</item>
/// <item>Webhook de Workflows: tarjeta adaptable con texto, enlace e imágenes por URL pública.</item>
/// </list>
/// Leer los mensajes del canal exige un permiso que solo concede un administrador, así que un corte justo al enviar
/// no se puede comprobar: pasa a revisión con instrucciones (nunca se duplica en silencio).
/// </summary>
public sealed class TeamsPublisher(PublisherServices services, TeamsClient teams, TeamsTokens tokens) : PlatformPublisherBase(services), IFirstCommentPublisher
{
    /// <summary>Imágenes que se meten dentro del mensaje (en total). Más, se adjuntan como archivos.</summary>
    public const long InlineImagesMax = 3L * 1024 * 1024;

    private sealed record FileRef(string AttachmentId, string Name, string WebUrl);

    private sealed class Session
    {
        public Dictionary<int, FileRef> Files { get; set; } = [];
    }

    public override string Platform => Platforms.Teams;

    public override async Task<PublishStep> UploadAsync(PublicationDueItem item, string filePath, string leaseOwner, UploadHeartbeat heartbeat)
    {
        if (Platforms.IsTeamsWebhook(item.Target, item.AccountExternalId)) return await WebhookAsync(item, heartbeat);

        CancellationToken cancellationToken = heartbeat.Token;
        var access = await tokens.AccessAsync(item.ConnectionKey, cancellationToken);
        if (access.Token is not { } token)
            return access.IsTransient ? PublishStep.Retry("TOKEN", access.Problem!) : PublishStep.NeedsReconnect("TOKEN", access.Problem!);

        var (teamId, channelId) = Split(item.AccountExternalId);
        var session = ReadSession<Session>(item.SessionData) ?? new Session();
        var options = item.Options;

        bool inline = item.PostKind is PostKinds.Image or PostKinds.Carousel && item.Media.Sum(m => m.SizeBytes) <= InlineImagesMax;
        var hosted = new JsonArray();
        var attachments = new JsonArray();
        var html = new StringBuilder();

        if (options.TeamsMentionChannel == true) html.Append($"<at id=\"0\">{Encode(ChannelName(item))}</at> ");
        html.Append(Paragraphs(item.Description));
        if (item.PostKind == PostKinds.Link && item.LinkUrl is { } link)
            html.Append($"<p><a href=\"{Encode(link)}\">{Encode(link)}</a></p>");

        if (inline)
        {
            for (int i = 0; i < item.Media.Count; i++)
            {
                var media = item.Media[i];
                string id = (i + 1).ToString();
                hosted.Add(new JsonObject
                {
                    ["@microsoft.graph.temporaryId"] = id,
                    ["contentBytes"] = Convert.ToBase64String(await File.ReadAllBytesAsync(media.FullPath, cancellationToken)),
                    ["contentType"] = media.ContentType
                });
                html.Append($"<p><img src=\"../hostedContents/{id}/$value\" alt=\"{Encode(media.AltText ?? string.Empty)}\"></p>");
            }
        }
        else if (item.Media.Count > 0)
        {
            var folder = await teams.FilesFolderAsync(token, teamId, channelId, cancellationToken);
            if (!folder.Ok) return Classify(folder.Error!);

            long total = Math.Max(item.Media.Sum(m => m.SizeBytes), 1), before = 0;
            foreach (var media in item.Media)
            {
                if (!session.Files.TryGetValue(media.Id, out var file))
                {
                    long offset = before;
                    var uploaded = await teams.UploadAsync(token, folder.Data.DriveId, folder.Data.FolderId, media.FullPath, Path.GetFileName(media.FullPath),
                        media.ContentType, sent => heartbeat.Report(offset + sent, total), cancellationToken);
                    if (!uploaded.Ok) return heartbeat.LeaseLost ? PublishStep.LeaseLost() : Classify(uploaded.Error!);
                    file = new FileRef(uploaded.Data!.AttachmentId, uploaded.Data.Name, uploaded.Data.WebUrl);
                    session.Files[media.Id] = file;
                    await SaveSessionAsync(item, leaseOwner, session, cancellationToken);
                }
                before += media.SizeBytes;
                attachments.Add(new JsonObject { ["id"] = file.AttachmentId, ["contentType"] = "reference", ["contentUrl"] = file.WebUrl, ["name"] = file.Name });
                html.Append($"<attachment id=\"{file.AttachmentId}\"></attachment>");
            }
        }

        var message = new JsonObject
        {
            ["subject"] = item.Title,
            ["body"] = new JsonObject { ["contentType"] = "html", ["content"] = html.ToString() }
        };
        if (hosted.Count > 0) message["hostedContents"] = hosted;
        if (attachments.Count > 0) message["attachments"] = attachments;
        if (options.TeamsMentionChannel == true)
            message["mentions"] = new JsonArray(new JsonObject
            {
                ["id"] = 0,
                ["mentionText"] = ChannelName(item),
                ["mentioned"] = new JsonObject
                {
                    ["conversation"] = new JsonObject { ["id"] = channelId, ["displayName"] = ChannelName(item), ["conversationIdentityType"] = "channel" }
                }
            });

        await heartbeat.MarkCommittingAsync();
        var posted = await teams.PostMessageAsync(token, teamId, channelId, message, cancellationToken);
        if (!posted.Ok) return Classify(posted.Error!);
        return PublishStep.Done(posted.Data.WebUrl, externalId: posted.Data.Id);
    }

    /// <summary>Tarjeta adaptable al webhook de Workflows. Las imágenes van por enlace público firmado.</summary>
    private async Task<PublishStep> WebhookAsync(PublicationDueItem item, UploadHeartbeat heartbeat)
    {
        string? url = Services.Protector.UnprotectOrNull(await Services.Connections.TokenGet(item.ConnectionKey, heartbeat.Token));
        if (url is null) return PublishStep.NeedsReconnect("NO_WEBHOOK", "El canal no tiene la URL del webhook. Quítalo y vuelve a añadirlo en Conexiones.");
        if (item.Media.Any(m => m.PublicUrl is null))
            return PublishStep.Failed("NO_PUBLIC_URL", "Un canal por webhook muestra las imágenes desde una dirección pública y este servidor no tiene una (App:PublicBaseUrl).");

        await heartbeat.MarkCommittingAsync();
        var sent = await teams.PostWebhookAsync(url, Card(item), heartbeat.Token);
        if (!sent.Ok) return Classify(sent.Error!);
        return PublishStep.Done(null, "Enviado al canal por webhook (Teams no devuelve enlace al mensaje).");
    }

    public static JsonObject Card(IPostContent item)
    {
        var body = new JsonArray
        {
            new JsonObject { ["type"] = "TextBlock", ["text"] = item.Title, ["weight"] = "Bolder", ["size"] = "Large", ["wrap"] = true }
        };
        if (!string.IsNullOrWhiteSpace(item.Description))
            body.Add(new JsonObject { ["type"] = "TextBlock", ["text"] = item.Description, ["wrap"] = true });
        foreach (var media in item.Media.Where(m => m.PublicUrl != null))
            body.Add(new JsonObject { ["type"] = "Image", ["url"] = media.PublicUrl, ["altText"] = media.AltText ?? string.Empty, ["size"] = "Stretch" });

        var card = new JsonObject
        {
            ["$schema"] = "http://adaptivecards.io/schemas/adaptive-card.json",
            ["type"] = "AdaptiveCard",
            ["version"] = "1.4",
            ["body"] = body
        };
        if (item.PostKind == PostKinds.Link && item.LinkUrl is { } link)
            card["actions"] = new JsonArray(new JsonObject { ["type"] = "Action.OpenUrl", ["title"] = "Abrir enlace", ["url"] = link });

        return new JsonObject
        {
            ["type"] = "message",
            ["attachments"] = new JsonArray(new JsonObject { ["contentType"] = "application/vnd.microsoft.card.adaptive", ["content"] = card })
        };
    }

    /// <summary>Nunca se llega aquí (Teams publica en el acto); por si una fila quedó en PROCESSING.</summary>
    public override Task<PublishStep> PollAsync(PublicationPollItem item, CancellationToken cancellationToken) =>
        Task.FromResult(PublishStep.Done(item.ExternalUrl));

    public async Task<CommentResult> CommentAsync(CommentRequest request, CancellationToken cancellationToken)
    {
        if (Platforms.IsTeamsWebhook(request.Target, request.AccountExternalId)) return CommentResult.Fail("un canal por webhook no admite respuestas.");
        var access = await tokens.AccessAsync(request.ConnectionKey, cancellationToken);
        if (access.Token is not { } token) return CommentResult.Fail(access.Problem!);

        var (teamId, channelId) = Split(request.AccountExternalId);
        var reply = await teams.ReplyAsync(token, teamId, channelId, request.PostExternalId, Paragraphs(request.Text), cancellationToken);
        return reply.Ok ? CommentResult.Ok(reply.Data!) : CommentResult.Fail(TeamsAccountService.Friendly(reply.Error!));
    }

    public override async Task<ConnectionTest> TestAsync(ConnectionRow connection, CancellationToken cancellationToken)
    {
        if (Platforms.IsTeamsWebhook(connection.Platform, connection.ExternalId))
            return Services.Protector.UnprotectOrNull(connection.SecretCipher) is null
                ? new(false, "No hay URL de webhook guardada: quita el canal y vuelve a añadirlo.")
                : new(true, "Canal por webhook: la URL está guardada. Un webhook no se puede comprobar sin publicar; haz una publicación de prueba.");

        var access = await tokens.AccessAsync(connection.ConnectionKey, cancellationToken);
        if (access.Token is not { } token) return new(false, access.Problem!);

        var (teamId, channelId) = Split(connection.ExternalId);
        var channel = await teams.ChannelAsync(token, teamId, channelId, cancellationToken);
        return channel.Ok
            ? new(true, $"Conexión correcta con «{connection.DisplayName}».")
            : new(false, channel.Error!.HttpStatus == 404
                ? "El canal ya no existe o ya no eres miembro. Quita el canal o elige otro."
                : TeamsAccountService.Friendly(channel.Error));
    }

    /// <summary>Error de Microsoft Graph → paso del job (lo comparten publicar y responder en la bandeja).</summary>
    public static PublishStep Classify(TeamsError error)
    {
        string tag = $"teams:{error.HttpStatus}:{error.Code}";
        return error.HttpStatus switch
        {
            401 => PublishStep.NeedsReconnect(tag, TeamsTokens.RejectedMessage),
            403 => PublishStep.Failed(tag, "No tienes permiso para escribir en este canal (puede que solo publiquen los moderadores o que ya no seas miembro). " +
                   "Pide que te den permiso o quita el canal."),
            404 => PublishStep.Failed(tag, "El canal de Teams ya no existe o ya no eres miembro. Quita el canal y elige otro."),
            413 => PublishStep.Failed(tag, "El mensaje es demasiado grande para Teams. Usa menos imágenes o más pequeñas."),
            429 => PublishStep.WaitQuota(tag, "Teams limitó los envíos por un momento. Se reintenta solo.", TimeClock.UtcNow.AddSeconds(Math.Clamp(error.RetryAfterSeconds ?? 60, 5, 3600))),
            _ when error.IsTransient => PublishStep.Retry(tag, $"Microsoft no responde bien ahora mismo ({error.HttpStatus}). Se reintenta solo."),
            _ => PublishStep.Failed(tag, $"Teams rechazó la publicación: {TeamsAccountService.Friendly(error)}")
        };
    }

    public static (string TeamId, string ChannelId) Split(string externalId)
    {
        int slash = externalId.IndexOf('/');
        return slash > 0 ? (externalId[..slash], externalId[(slash + 1)..]) : (externalId, string.Empty);
    }

    /// <summary>«Equipo › Canal» → «Canal» (lo que se ve al mencionar el canal).</summary>
    private static string ChannelName(PublicationDueItem item) =>
        item.AccountName.Split('›').Last().Trim() is { Length: > 0 } name ? name : "canal";

    private static string Encode(string value) => WebUtility.HtmlEncode(value);

    /// <summary>Texto plano a HTML seguro: se escapa y cada línea se respeta.</summary>
    public static string Paragraphs(string? text) =>
        string.IsNullOrWhiteSpace(text) ? string.Empty
            : $"<p>{string.Join("<br>", text.Replace("\r", "").Split('\n').Select(Encode))}</p>";
}
