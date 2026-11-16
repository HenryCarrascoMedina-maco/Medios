using System.Text.Json;
using System.Text.Json.Nodes;
using YoutubeMeta.Api.Application.Inbox;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.External.Meta;

namespace YoutubeMeta.Api.Infrastructure.External.WhatsApp;

/// <summary>
/// WhatsApp Business: cada número conectado es una cuenta (ExternalId = phone_number_id) y cada persona, una
/// conversación (ExternalId = su wa_id). Llega por el webhook de la app de Meta (objeto whatsapp_business_account).
/// Fuera de las 24 h desde su último mensaje solo se puede enviar una plantilla aprobada.
/// </summary>
public sealed class WhatsAppInbox(InboxChannelServices services, WhatsAppClient whatsapp, MetaGraphClient graph) : InboxChannelBase(services)
{
    private const string MessagingScope = "whatsapp_business_messaging";

    public override string Platform => Platforms.WhatsApp;

    public override InboxAccountStatus Inspect(InboxAccountRow account, InboxEnvironment environment)
    {
        if (MetaWebhookProblem(environment) is { } server) return new(true, false, InboxModes.Webhook, server.Problem, server.Fix);
        if (MissingScope(account, MessagingScope) is { } scope)
            return new(true, false, InboxModes.Webhook, $"Al token le falta el permiso {scope}. Genéralo de nuevo y vuelve a conectar el número.", InboxFixes.Reconnect);
        return new(true, false, InboxModes.Webhook);
    }

    /// <summary>Suscribe la app a la cuenta de WhatsApp Business del número (sin esto no llegan los mensajes).</summary>
    public override async Task<string?> PrepareAsync(InboxAccountRow account, InboxEnvironment environment, CancellationToken cancellationToken)
    {
        if (MetaWebhookProblem(environment) is { } server) return server.Problem;
        if (ConnectionExtra.Parse(account.Extra).WabaId is not { } wabaId) return "Falta la cuenta de WhatsApp Business del número: vuelve a conectarlo.";
        if (await TokenAsync(account.ConnectionKey, cancellationToken) is not { } token) return $"{account.Name} no tiene un acceso válido. Vuelve a conectarlo.";

        var subscribed = await graph.SubscribeAppAsync(wabaId, token, null, cancellationToken);
        return subscribed.Ok ? null : $"No se pudo suscribir la cuenta de WhatsApp Business a los avisos: {MetaErrorClassifier.Friendly(subscribed.Error!)}";
    }

    public override Task<IReadOnlyList<InboxUpdate>> ParseAsync(InboxEventRow inboxEvent, IReadOnlyList<InboxAccountRow> accounts, CancellationToken cancellationToken)
    {
        using var document = JsonDocument.Parse(inboxEvent.Payload);
        var updates = new List<InboxUpdate>();

        foreach (var change in Items(document.RootElement, "changes"))
        {
            if (Text(change, "field") != "messages") continue;
            var value = Child(change, "value");
            if (Text(Child(value, "metadata"), "phone_number_id") is not { } phoneId || AccountFor(accounts, phoneId) is not { } account) continue;

            var names = Items(value, "contacts").ToDictionary(c => Text(c, "wa_id") ?? string.Empty, c => Text(Child(c, "profile"), "name"));

            if (account.InboxDirect)
                foreach (var message in Items(value, "messages"))
                {
                    if (Text(message, "from") is not { } from || Text(message, "id") is not { } id) continue;
                    string? name = names.GetValueOrDefault(from);
                    var contact = new InboxContact(from, name, $"+{from}");
                    var (body, attachments) = ReadContent(message);
                    updates.Add(new InboxIncoming(account.Id, InboxKinds.Direct, from, name ?? $"+{from}", id, InboxDirections.In,
                        UnixSeconds(message, "timestamp", TimeClock.UtcNow), body, contact,
                        AuthorName: name, AuthorExternalId: from, ParentExternalId: Text(Child(message, "context"), "id"))
                    {
                        Attachments = attachments
                    });
                }

            foreach (var status in Items(value, "statuses"))
            {
                if (Text(status, "id") is not { } id) continue;
                string? mapped = Text(status, "status") switch
                {
                    "sent" => InboxMessageStatus.Sent,
                    "delivered" => InboxMessageStatus.Delivered,
                    "read" => InboxMessageStatus.Read,
                    "failed" => InboxMessageStatus.Failed,
                    _ => null
                };
                if (mapped is null) continue;
                string? error = Items(status, "errors").Select(e => Text(Child(e, "error_data"), "details") ?? Text(e, "message") ?? Text(e, "title")).FirstOrDefault();
                updates.Add(new InboxStatusChange(id, mapped, error is null ? null : $"WhatsApp no entregó el mensaje: {error}"));
            }
        }
        return Task.FromResult<IReadOnlyList<InboxUpdate>>(updates);
    }

    public override async Task<PublishStep> SendAsync(InboxSendContext context, CancellationToken cancellationToken)
    {
        var item = context.Item;
        if (await TokenAsync(item.ConnectionKey, cancellationToken) is not { } token) return NoTokenStep(item.AccountName);
        string to = item.ConversationExternalId;
        var options = item.SendOptions;

        if (options.TemplateName is { } template)
        {
            var content = new JsonObject
            {
                ["type"] = "template",
                ["template"] = new JsonObject
                {
                    ["name"] = template,
                    ["language"] = new JsonObject { ["code"] = options.TemplateLanguage ?? "es" },
                    ["components"] = new JsonArray(new JsonObject
                    {
                        ["type"] = "body",
                        ["parameters"] = new JsonArray(options.TemplateParams.Select(p => (JsonNode)new JsonObject { ["type"] = "text", ["text"] = p }).ToArray())
                    })
                }
            };
            return Result(await whatsapp.SendAsync(item.AccountExternalId, token, to, content, null, cancellationToken));
        }

        if (context.Window == InboxWindowState.Closed)
            return PublishStep.Failed("WINDOW_CLOSED", "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo deja enviar una plantilla aprobada.");

        string? lastId = null;
        foreach (var media in context.Media)
        {
            var uploaded = await whatsapp.UploadAsync(item.AccountExternalId, token, media.Path, media.FileName, media.ContentType, cancellationToken);
            if (!uploaded.Ok) return Classify(uploaded.Error!);
            string type = media.MediaKind switch { MediaKinds.Image => "image", MediaKinds.Video => "video", _ => "document" };
            var file = new JsonObject { ["id"] = uploaded.Data };
            if (type == "document") file["filename"] = media.FileName;
            var sent = await whatsapp.SendAsync(item.AccountExternalId, token, to, new JsonObject { ["type"] = type, [type] = file }, null, cancellationToken);
            if (!sent.Ok) return Classify(sent.Error!);
            lastId = sent.Data;
        }

        if (!string.IsNullOrWhiteSpace(item.Body))
        {
            var content = new JsonObject { ["type"] = "text", ["text"] = new JsonObject { ["body"] = item.Body.Trim(), ["preview_url"] = true } };
            var sent = await whatsapp.SendAsync(item.AccountExternalId, token, to, content, item.ParentExternalId, cancellationToken);
            if (!sent.Ok) return Classify(sent.Error!);
            lastId = sent.Data;
        }
        return PublishStep.Done(null, externalId: lastId);
    }

    public override async Task<InboxFile?> DownloadAsync(ConnectionRow connection, string mediaId, CancellationToken cancellationToken)
    {
        if (Services.Protector.UnprotectOrNull(connection.SecretCipher) is not { } token) return null;
        return await whatsapp.DownloadAsync(mediaId, token, cancellationToken) is { } file ? new InboxFile(file.Content, file.ContentType, null) : null;
    }

    public override async Task<ConnectionTest?> TestAsync(ConnectionRow connection, CancellationToken cancellationToken)
    {
        if (Services.Protector.UnprotectOrNull(connection.SecretCipher) is not { } token) return new(false, "El número no tiene un acceso válido. Vuelve a conectarlo.");
        var number = await whatsapp.NumberAsync(connection.ExternalId, ConnectionExtra.Parse(connection.Extra).WabaId ?? string.Empty, token, cancellationToken);
        return number.Ok
            ? new(true, $"Conexión correcta con {number.Data!.DisplayPhoneNumber} ({number.Data.VerifiedName}).")
            : new(false, MetaErrorClassifier.Friendly(number.Error!));
    }

    /// <summary>Errores propios de WhatsApp antes de los generales de Meta.</summary>
    public static PublishStep Classify(MetaError error) => error.Code switch
    {
        131047 => PublishStep.Failed("whatsapp:131047", "Pasaron más de 24 h desde el último mensaje del cliente: envía una plantilla aprobada."),
        131026 => PublishStep.Failed("whatsapp:131026", "WhatsApp no pudo entregar el mensaje (el número no usa WhatsApp o no aceptó las condiciones)."),
        131056 or 130429 => PublishStep.WaitQuota($"whatsapp:{error.Code}", "WhatsApp limitó los envíos por un momento. Se reintenta solo.", TimeClock.UtcNow.AddMinutes(1)),
        132000 or 132001 or 132005 or 132007 or 132012 => PublishStep.Failed($"whatsapp:{error.Code}", $"La plantilla no es válida: {error.Message}"),
        _ => MetaErrorClassifier.Classify(error)
    };

    private static PublishStep Result(MetaResult<string> sent) => sent.Ok ? PublishStep.Done(null, externalId: sent.Data) : Classify(sent.Error!);

    /// <summary>Texto y adjuntos de un mensaje según su tipo.</summary>
    private static (string? Body, IReadOnlyList<InboxAttachment> Attachments) ReadContent(JsonElement message)
    {
        string type = Text(message, "type") ?? "unknown";
        var media = Child(message, type);
        switch (type)
        {
            case "text":
                return (Text(media, "body"), []);
            case "image" or "video" or "audio" or "document" or "sticker":
                return (Text(media, "caption"), [new InboxAttachment
                {
                    Kind = type,
                    MediaId = Text(media, "id"),
                    ContentType = Text(media, "mime_type"),
                    Name = Text(media, "filename")
                }]);
            case "button":
                return (Text(media, "text"), []);
            case "interactive":
                var reply = Child(media, Text(media, "type") ?? "button_reply");
                return (Text(reply, "title"), []);
            case "location":
                return ($"📍 Ubicación: {Text(media, "name") ?? $"{Text(media, "latitude")}, {Text(media, "longitude")}"}", []);
            case "reaction":
                return ($"Reaccionó con {Text(media, "emoji")}", []);
            case "contacts":
                return ("👤 Compartió un contacto", []);
            default:
                return ($"(Mensaje de tipo «{type}» que la app aún no muestra: ábrelo en WhatsApp)", []);
        }
    }
}
