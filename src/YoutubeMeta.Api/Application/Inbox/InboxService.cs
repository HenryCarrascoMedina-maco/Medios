using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.External;
using YoutubeMeta.Api.Infrastructure.External.WhatsApp;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;
using YoutubeMeta.Api.Infrastructure.Storage;

#region RESPONSES
using ConversationsResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.InboxConversationItem>>;
using ConversationResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Responses.InboxConversationItem>;
using MessagesResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.InboxMessageItem>>;
using MessageResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Responses.InboxMessageItem>;
using ContactsResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.InboxContactItem>>;
using TemplatesResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.WhatsAppTemplateItem>>;
using ContactResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Responses.InboxContactDetail>;
#endregion

namespace YoutubeMeta.Api.Application.Inbox;

/// <summary>
/// La bandeja para la API: conversaciones, respuestas (a la cola del job), notas internas, estados, contactos
/// y Configuración › Bandeja (las respuestas con /atajo son plantillas: ContentService). Las reglas de cada plataforma salen de <see cref="InboxRules"/>.
/// </summary>
public sealed partial class InboxService(
        InboxRepository inbox,
        InboxChannels channels,
        ConnectionRepository connections,
        VideoRepository videos,
        VideoStorage storage,
        PlatformKeys keys,
        WhatsAppClient whatsapp,
        SecretProtector protector,
        MediaLinks links,
        IMemoryCache cache,
        IProgressNotifier notifier,
        ExceptionHelper exception)
{
    private static readonly TimeSpan TemplatesLifetime = TimeSpan.FromMinutes(10);
    private const string ConversationMissing = "La conversación no existe. Recarga la bandeja.";
    private const string PhoneWithoutCountry = "El teléfono necesita el código de país, por ejemplo +51 987 654 321.";

    private InboxSettings Settings => channels.Settings;

    #region CONVERSACIONES
    public Task<ConversationsResponse> Conversations(InboxConversationQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ConversationsResponse>(async () =>
            ConversationsResponse.Ok(WithWindows(await inbox.Conversations(query, cancellationToken))));

    public Task<ConversationResponse> Conversation(long id, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ConversationResponse>(() => ConversationAsync(id, ConversationMissing, cancellationToken));

    public Task<CustomTransactionResponse<InboxCounts>> Counts(CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<InboxCounts>>(async () =>
            CustomTransactionResponse<InboxCounts>.Ok(await inbox.Counts(cancellationToken)));

    public Task<ConversationResponse> Update(long id, InboxConversationUpdateRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ConversationResponse>(async () =>
        {
            if (request.StatusCode is not null && !InboxConversationStatus.IsValid(request.StatusCode)) return ConversationResponse.Fail("Estado no válido.");
            var tags = request.Tags?.Select(t => t.Trim().Replace(",", " ")).Where(t => t.Length > 0).Select(t => t.Length > 50 ? t[..50] : t)
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

            await inbox.ConversationUpdate(id, request.StatusCode, request.MarkRead, tags, cancellationToken);
            await NotifyAsync(id, cancellationToken);
            return await ConversationAsync(id, "La conversación no existe.", cancellationToken);
        });

    private async Task<ConversationResponse> ConversationAsync(long id, string missing, CancellationToken cancellationToken) =>
        await inbox.Conversation(id, cancellationToken) is { } item ? ConversationResponse.Ok(WithWindow(item)) : ConversationResponse.Fail(missing);

    private static InboxConversationItem WithWindow(InboxConversationItem item) => InboxRules.WithWindow(item);

    private static IReadOnlyList<InboxConversationItem> WithWindows(IReadOnlyList<InboxConversationItem> items)
    {
        foreach (var item in items) WithWindow(item);
        return items;
    }
    #endregion

    #region MENSAJES
    public Task<MessagesResponse> Messages(long conversationId, InboxMessageQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<MessagesResponse>(async () => MessagesResponse.Ok(await inbox.Messages(conversationId, query, cancellationToken)));

    /// <summary>Nota interna (se guarda y ya) o respuesta: se valida con las reglas de la plataforma y va a la cola del job.</summary>
    public Task<MessageResponse> Reply(long conversationId, InboxReplyRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<MessageResponse>(async () =>
        {
            var conversation = await inbox.Conversation(conversationId, cancellationToken);
            if (conversation is null) return MessageResponse.Fail(ConversationMissing);
            string? body = string.IsNullOrWhiteSpace(request.Body) ? null : request.Body.Trim();

            long id;
            if (request.Note)
            {
                if (body is null) return MessageResponse.Fail("Escribe la nota.");
                if (body.Length > InboxRules.NoteMax) return MessageResponse.Fail($"La nota admite como mucho {InboxRules.NoteMax} caracteres.");
                id = await inbox.MessageCreate(conversationId, InboxDirections.Note, body, null, null, userName, cancellationToken);
            }
            else
            {
                if (!channels.IsEnabled(conversation.Platform))
                    return MessageResponse.Fail($"{Platforms.Label(conversation.Platform)} no está disponible en la bandeja de esta instalación.");

                string? template = string.IsNullOrWhiteSpace(request.TemplateName) ? null : request.TemplateName.Trim();
                var mediaIds = request.MediaIds.Distinct().ToList();
                string? parent = await ReplyTargetAsync(conversation, request.ParentExternalId, cancellationToken);
                var check = new InboxReplyCheck(conversation.Platform, conversation.Kind, conversation.LastInboundAt, body, mediaIds.Count,
                    request.PrivateReply, parent, template);
                if (InboxRules.ValidateReply(check, TimeClock.UtcNow, Settings.MetaHumanAgentTag, links.IsAvailable) is { } invalid) return MessageResponse.Fail(invalid);
                var attachments = new List<InboxAttachment>();
                foreach (int mediaId in mediaIds)
                {
                    if (await videos.GetFile(mediaId, cancellationToken) is not { } file)
                        return MessageResponse.Fail("Uno de los archivos adjuntos ya no existe en la biblioteca.");
                    attachments.Add(InboxAttachment.FromLibrary(file));
                }

                var options = new InboxSendOptions
                {
                    PrivateReply = request.PrivateReply,
                    MediaIds = mediaIds,
                    TemplateName = template,
                    TemplateLanguage = template is null ? null : request.TemplateLanguage,
                    TemplateParams = template is null ? [] : request.TemplateParams
                };
                string? shown = template is null ? body : $"📋 Plantilla «{template}»" + (request.TemplateParams.Count > 0 ? $": {string.Join(" · ", request.TemplateParams)}" : string.Empty);
                id = await inbox.MessageCreate(conversationId, InboxDirections.Out, shown, options.ToJson(), parent, userName, cancellationToken, attachments);
            }

            await NotifyAsync(conversationId, cancellationToken);
            return await inbox.Message(id, cancellationToken) is { } message ? MessageResponse.Ok(message) : MessageResponse.Fail("No se pudo guardar el mensaje.");
        });

    /// <summary>
    /// Mensaje citado o comentario al que se responde. En comentarios las respuestas cuelgan del comentario principal
    /// (YouTube, Instagram y Facebook no anidan más), así que si se eligió una respuesta se usa su comentario padre.
    /// </summary>
    private async Task<string?> ReplyTargetAsync(InboxConversationItem conversation, string? externalId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(externalId)) return null;
        if (conversation.Kind != InboxKinds.Comments) return externalId;
        var recent = await inbox.Messages(conversation.Id, new InboxMessageQuery { Take = 200 }, cancellationToken);
        return recent.FirstOrDefault(m => m.ExternalId == externalId)?.ParentExternalId ?? externalId;
    }

    public Task<MessageResponse> Resolve(long messageId, InboxMessageResolveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<MessageResponse>(async () =>
        {
            if (!InboxResolution.IsValid(request.Action)) return MessageResponse.Fail("Acción no válida.");
            long conversationId = await inbox.MessageResolve(messageId, request.Action, cancellationToken);
            await NotifyAsync(conversationId, cancellationToken);
            return await inbox.Message(messageId, cancellationToken) is { } message ? MessageResponse.Ok(message) : MessageResponse.Fail("El mensaje no existe.");
        });

    /// <summary>
    /// Adjunto de un mensaje: si lo enviamos nosotros sale de la biblioteca; si lo recibimos y la plataforma lo guarda
    /// (WhatsApp, Telegram), se descarga de ella bajo demanda.
    /// </summary>
    public async Task<InboxFile?> Attachment(long messageId, int index, CancellationToken cancellationToken)
    {
        if (await inbox.Message(messageId, cancellationToken) is not { } message
            || message.AttachmentList.ElementAtOrDefault(index) is not { } attachment)
            return null;

        if (attachment.LibraryId is { } libraryId)
        {
            if (await videos.GetFile(libraryId, cancellationToken) is not { } library) return null;
            string path = storage.Resolve(library.StoragePath);
            return File.Exists(path) ? new InboxFile(File.OpenRead(path), library.ContentType, attachment.Name ?? library.OriginalFileName) : null;
        }

        // Copia local de un archivo recibido: no depende de que la red lo siga guardando.
        if (attachment.StoredPath is { } stored && storage.Resolve(stored) is var copy && File.Exists(copy))
            return new InboxFile(File.OpenRead(copy), attachment.ContentType ?? "application/octet-stream", attachment.Name ?? Path.GetFileName(copy));

        if (attachment.MediaId is not { } mediaId
            || await inbox.Conversation(message.ConversationId, cancellationToken) is not { } conversation
            || channels.For(conversation.Platform) is not { } channel
            || await connections.Get(conversation.ConnectionId, cancellationToken) is not { } connection)
            return null;

        var file = await channel.DownloadAsync(connection, mediaId, cancellationToken);
        return file is null ? null : file with { ContentType = attachment.ContentType ?? file.ContentType, FileName = attachment.Name ?? file.FileName };
    }

    /// <summary>Plantillas aprobadas de un número de WhatsApp (se guardan 10 min en memoria).</summary>
    public Task<TemplatesResponse> Templates(int connectionId, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<TemplatesResponse>(async () =>
        {
            var connection = await connections.Get(connectionId, cancellationToken);
            if (connection?.Platform != Platforms.WhatsApp) return TemplatesResponse.Fail("Las plantillas solo existen en WhatsApp.");
            if (ConnectionExtra.Parse(connection.Extra).WabaId is not { } wabaId || protector.UnprotectOrNull(connection.SecretCipher) is not { } token)
                return TemplatesResponse.Fail("El número no tiene un acceso válido. Vuelve a conectarlo en Conexiones.");

            string key = $"inbox:templates:{wabaId}";
            if (cache.TryGetValue(key, out IReadOnlyList<WhatsAppTemplateItem>? cached) && cached is not null) return TemplatesResponse.Ok(cached);

            var templates = await whatsapp.TemplatesAsync(wabaId, token, cancellationToken);
            if (!templates.Ok) return TemplatesResponse.Fail(Infrastructure.External.Meta.MetaErrorClassifier.Friendly(templates.Error!));
            var approved = templates.Data!.Where(t => t.Status == "APPROVED").OrderBy(t => t.Name).ToList();
            cache.Set(key, (IReadOnlyList<WhatsAppTemplateItem>)approved, TemplatesLifetime);
            return TemplatesResponse.Ok(approved);
        });
    #endregion

    #region CONTACTOS
    public Task<ContactResponse> Contact(int id, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ContactResponse>(() => ContactAsync(id, "El contacto no existe.", cancellationToken));

    public Task<ContactsResponse> ContactSearch(ContactSearchQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ContactsResponse>(async () => ContactsResponse.Ok(await inbox.ContactSearch(query, cancellationToken)));

    public Task<ContactResponse> ContactLink(int id, ContactLinkRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ContactResponse>(async () =>
        {
            await inbox.ContactLink(id, request.OtherId, cancellationToken);
            return await ContactAsync(id, "El contacto no existe.", cancellationToken);
        });

    /// <summary>Alta en la agenda: alguien que aún no escribió por ninguna red (para escribirle o invitarle).</summary>
    public Task<ContactResponse> ContactCreate(ContactCreateRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ContactResponse>(async () =>
        {
            string name = request.DisplayName?.Trim() ?? string.Empty;
            if (name.Length is 0 or > 200) return ContactResponse.Fail("Escribe el nombre del contacto (hasta 200 caracteres).");

            string? phone = null;
            if (!string.IsNullOrWhiteSpace(request.Phone) && (phone = InboxRules.NormalizePhone(request.Phone)) is null)
                return ContactResponse.Fail(PhoneWithoutCountry);

            string? email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim();
            if (email is not null && (email.Length > 200 || !EmailFormat().IsMatch(email)))
                return ContactResponse.Fail("El correo no parece válido.");

            int id = await inbox.ContactCreate(name, phone, email, userName, cancellationToken);
            return await ContactAsync(id, "No se pudo guardar el contacto.", cancellationToken);
        });

    private async Task<ContactResponse> ContactAsync(int id, string missing, CancellationToken cancellationToken) =>
        await inbox.Contact(id, cancellationToken) is { } detail ? ContactResponse.Ok(detail) : ContactResponse.Fail(missing);

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailFormat();
    #endregion

    #region EMPEZAR CONVERSACIONES
    /// <summary>
    /// Escribir primero por WhatsApp: crea (o reutiliza) la conversación con ese número, deja una nota con quién la empezó
    /// y el consentimiento, y encola la plantilla. Las demás redes no dejan escribir primero: para ellas, <see cref="InviteCreate"/>.
    /// </summary>
    public Task<ConversationResponse> ConversationStart(ConversationStartRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ConversationResponse>(async () =>
        {
            var account = await FindAccountAsync(request.ConnectionId, cancellationToken);
            if (account is null || account.Platform != Platforms.WhatsApp)
                return ConversationResponse.Fail("Solo WhatsApp deja escribir primero a un número. En las demás redes envía un enlace de invitación.");
            if (!channels.IsEnabled(account.Platform) || account.StatusCode != ConnectionStatus.Connected)
                return ConversationResponse.Fail($"{account.Name} no está conectado. Revísalo en Conexiones.");
            if (!request.Consent)
                return ConversationResponse.Fail("Confirma que la persona aceptó recibir mensajes de WhatsApp: Meta lo exige y puede bloquear el número si no.");
            if (InboxRules.NormalizePhone(request.Phone) is not { } phone)
                return ConversationResponse.Fail(PhoneWithoutCountry);
            if (string.IsNullOrWhiteSpace(request.TemplateName))
                return ConversationResponse.Fail("Elige una plantilla aprobada: WhatsApp no deja empezar con texto libre.");

            InboxContactItem? person = null;
            if (request.ContactId is { } contactId && (person = (await inbox.Contact(contactId, cancellationToken))?.Contact) is null)
                return ConversationResponse.Fail("El contacto no existe. Búscalo de nuevo.");

            string name = TextHelper.FirstNonBlank(request.DisplayName, person?.DisplayName) ?? phone;
            // WhatsApp identifica a la persona por su número sin «+» (wa_id).
            long conversationId = await inbox.ConversationStart(account.Id, phone[1..], name, phone, person?.Id, cancellationToken);

            await inbox.MessageCreate(conversationId, InboxDirections.Note,
                $"Conversación iniciada por {userName} con una plantilla. Confirmó que la persona aceptó recibir mensajes de WhatsApp.",
                null, null, userName, cancellationToken);
            var sent = await Reply(conversationId, new InboxReplyRequest
            {
                TemplateName = request.TemplateName.Trim(),
                TemplateLanguage = request.TemplateLanguage,
                TemplateParams = request.TemplateParams
            }, userName, cancellationToken);
            if (!sent.IsSuccess) return ConversationResponse.Fail(sent.Errors.FirstOrDefault() ?? "No se pudo encolar la plantilla.");

            return await ConversationAsync(conversationId, ConversationMissing, cancellationToken);
        });

    /// <summary>
    /// Enlace de invitación (Telegram, Messenger, Instagram): de un solo uso y con caducidad. Cuando la persona abre el
    /// chat con él, su cuenta en esa red queda vinculada a <see cref="InviteCreateRequest.ContactId"/>.
    /// </summary>
    public Task<CustomTransactionResponse<InboxInviteItem>> InviteCreate(InviteCreateRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<InboxInviteItem>>(async () =>
        {
            var account = await FindAccountAsync(request.ConnectionId, cancellationToken);
            if (account is null || channels.For(account.Platform) is not { } channel)
                return CustomTransactionResponse<InboxInviteItem>.Fail("La cuenta no existe o no recibe mensajes en la bandeja.");
            if (account.StatusCode != ConnectionStatus.Connected)
                return CustomTransactionResponse<InboxInviteItem>.Fail($"{account.Name} no está conectada. Revísala en Conexiones.");
            if (!account.InboxDirect)
                return CustomTransactionResponse<InboxInviteItem>.Fail($"{account.Name} tiene apagados los mensajes privados en Configuración › Bandeja: no llegaría.");

            string code = InboxAgenda.NewInviteCode();
            if (await channel.InviteLinkAsync(account, code, cancellationToken) is not { } link)
                return CustomTransactionResponse<InboxInviteItem>.Fail(account.Platform == Platforms.WhatsApp
                    ? "En WhatsApp no hace falta enlace: escríbele a su número con una plantilla."
                    : $"No se pudo crear el enlace de {Platforms.Label(account.Platform)} para {account.Name}.");

            var invite = await inbox.InviteCreate(code, request.ContactId, account.Id, link,
                TimeClock.UtcNow.AddDays(Math.Max(Settings.InviteDays, 1)), userName, cancellationToken);
            return invite is null
                ? CustomTransactionResponse<InboxInviteItem>.Fail("No se pudo guardar la invitación.")
                : CustomTransactionResponse<InboxInviteItem>.Ok(invite);
        });
    #endregion

    #region CONFIGURACIÓN › BANDEJA
    public Task<CustomTransactionResponse<InboxSettingsResponse>> SettingsGet(CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<InboxSettingsResponse>>(async () =>
        {
            var environment = await channels.EnvironmentAsync(cancellationToken);
            var meta = await keys.MetaAppAsync(cancellationToken);
            var accounts = (await inbox.Accounts(cancellationToken))
                .Where(a => channels.IsEnabled(a.Platform) || a.Platform == Platforms.TikTok)
                .Select(a => Describe(a, environment))
                .ToList();

            return CustomTransactionResponse<InboxSettingsResponse>.Ok(new InboxSettingsResponse
            {
                Accounts = accounts,
                PublicUrlConfigured = environment.PublicUrl,
                MetaWebhookUrl = keys.MetaWebhookUrl,
                MetaVerifyToken = meta.Settings.VerifyToken.Length > 0 ? meta.Settings.VerifyToken : null,
                MetaAppConfigured = environment.MetaAppConfigured,
                HumanAgentEnabled = Settings.MetaHumanAgentTag,
                RetentionMonths = Settings.MessageRetentionMonths,
                KeepReceivedFiles = Settings.KeepReceivedFiles,
                KeepFileMaxMb = Settings.KeepFileMaxMb,
                InviteDays = Settings.InviteDays
            });
        });

    public Task<CustomTransactionResponse<InboxAccountItem>> AccountSave(int connectionId, InboxAccountSettingsRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<InboxAccountItem>>(async () =>
        {
            await inbox.AccountSettingsSave(connectionId, request.InboxDirect, request.InboxComments, cancellationToken);
            return await AccountAsync(connectionId, null, cancellationToken);
        });

    /// <summary>«Preparar de nuevo»: vuelve a suscribir la cuenta a los avisos (o a poner el webhook del bot).</summary>
    public Task<CustomTransactionResponse<InboxAccountItem>> AccountPrepare(int connectionId, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<InboxAccountItem>>(async () =>
        {
            var account = await FindAccountAsync(connectionId, cancellationToken);
            if (account is null || channels.For(account.Platform) is not { } channel)
                return CustomTransactionResponse<InboxAccountItem>.Fail("La cuenta no existe o no recibe mensajes.");

            var environment = await channels.EnvironmentAsync(cancellationToken);
            string? problem = await channel.PrepareAsync(account, environment, cancellationToken);
            await inbox.SyncSave(account.SyncKey, account.SyncCursor, TimeClock.UtcNow, problem is null, problem, cancellationToken);
            return problem is null ? await AccountAsync(connectionId, environment, cancellationToken) : CustomTransactionResponse<InboxAccountItem>.Fail(problem);
        });

    public InboxRulesInfo Rules() => InboxRules.Describe(Settings.MetaHumanAgentTag, links.IsAvailable);

    private async Task<CustomTransactionResponse<InboxAccountItem>> AccountAsync(int connectionId, InboxEnvironment? environment, CancellationToken cancellationToken)
    {
        environment ??= await channels.EnvironmentAsync(cancellationToken);
        var account = await FindAccountAsync(connectionId, cancellationToken);
        return account is null
            ? CustomTransactionResponse<InboxAccountItem>.Fail("La cuenta no existe o se quitó.")
            : CustomTransactionResponse<InboxAccountItem>.Ok(Describe(account, environment));
    }

    private async Task<InboxAccountRow?> FindAccountAsync(int connectionId, CancellationToken cancellationToken) =>
        (await inbox.Accounts(cancellationToken)).FirstOrDefault(a => a.Id == connectionId);

    private InboxAccountItem Describe(InboxAccountRow account, InboxEnvironment environment)
    {
        var status = channels.Inspect(account, environment);
        return new InboxAccountItem
        {
            Id = account.Id,
            Platform = account.Platform,
            Name = account.Name,
            AvatarUrl = account.AvatarUrl,
            AccountHint = account.AccountHint,
            StatusCode = account.StatusCode,
            CredentialName = account.CredentialName,
            InboxDirect = account.InboxDirect && status.SupportsDirect,
            InboxComments = account.InboxComments && status.SupportsComments,
            SupportsDirect = status.SupportsDirect,
            SupportsComments = status.SupportsComments,
            Mode = status.Mode,
            Problem = status.Problem,
            Fix = status.Fix,
            LastOkAt = account.LastOkAt,
            LastError = status.Problem is null ? account.LastError : null,
            LastInboundAt = account.LastInboundAt,
            OpenConversations = account.OpenConversations
        };
    }
    #endregion

    private Task NotifyAsync(long conversationId, CancellationToken cancellationToken) =>
        notifier.NotifyAsync(RealTimeEntities.Inbox, new { conversationId, isNew = false }, cancellationToken);
}
