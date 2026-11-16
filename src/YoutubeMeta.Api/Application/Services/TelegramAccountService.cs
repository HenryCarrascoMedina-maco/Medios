using YoutubeMeta.Api.Infrastructure.External.Telegram;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;

#region RESPONSES
using ChatsResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.TelegramChatOption>>;
using SaveResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Responses.AccountSaveResult>;
#endregion

namespace YoutubeMeta.Api.Application.Services;

/// <summary>
/// Canales de Telegram. Cada canal se publica con un bot guardado en Ajustes que debe ser administrador
/// con permiso de publicar. Un mismo bot sirve para todos los canales.
/// </summary>
public sealed class TelegramAccountService(
        TelegramBotClient telegram,
        TelegramBots bots,
        ConnectionRepository connections,
        InboxRepository inbox,
        IProgressNotifier notifier,
        ExceptionHelper exception)
{
    /// <summary>
    /// Canales donde añadieron al bot en las últimas 24 h, con si ya puede publicar. Salen de getUpdates y, cuando la
    /// bandeja ya consume esas novedades (getUpdates confirma lo leído o el bot tiene webhook), de lo que guardó la bandeja.
    /// </summary>
    public Task<ChatsResponse> Chats(TelegramChatsRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ChatsResponse>(async () =>
        {
            var bot = await bots.GetAsync(request.CredentialId, cancellationToken);
            if (bot == null) return ChatsResponse.Fail("El bot no existe. Añádelo primero en Ajustes › Plataformas.");

            var me = await telegram.GetMeAsync(bot.BaseUrl, bot.Token, cancellationToken);
            if (!me.Ok) return ChatsResponse.Fail(TelegramPublisher.Friendly(me.Error!));

            var stored = TelegramBotClient.ChatsFromUpdates(
                await inbox.EventsRecent(Platforms.Telegram, TelegramBotClient.EventKeyPrefix(bot.CredentialId), TimeClock.UtcNow.AddHours(-24), cancellationToken));
            var recent = await telegram.RecentChatsAsync(bot.BaseUrl, bot.Token, cancellationToken);
            if (!recent.Ok && recent.Error!.Code != 409) return ChatsResponse.Fail(TelegramPublisher.Friendly(recent.Error));
            var chats = (recent.Ok ? recent.Data! : []).Concat(stored).DistinctBy(c => c.Id).ToList();
            if (!recent.Ok && chats.Count == 0)
                return ChatsResponse.Fail("El bot tiene un webhook activo y todavía no recibió avisos de ningún canal. Escribe el @usuario del canal a mano.");

            var connected = (await connections.List(cancellationToken))
                .Where(c => c.Platform == Platforms.Telegram && c.StatusCode != ConnectionStatus.Revoked)
                .Select(c => c.ExternalId)
                .ToHashSet();

            var options = new List<TelegramChatOption>();
            foreach (var chat in chats)
            {
                var member = await telegram.GetChatMemberAsync(bot.BaseUrl, bot.Token, chat.Id, me.Data!.Id, cancellationToken);
                bool canPost = member.Ok && member.Data!.CanPost;
                options.Add(new TelegramChatOption
                {
                    Id = chat.Id,
                    Title = chat.Title,
                    Username = chat.Username,
                    Type = chat.Type,
                    CanPost = canPost,
                    Problem = canPost ? null : member.Ok ? "El bot no es administrador con permiso «Publicar mensajes»." : TelegramPublisher.Friendly(member.Error!),
                    AlreadyConnected = connected.Contains(chat.Id)
                });
            }
            return ChatsResponse.Ok(options);
        });

    /// <summary>Conecta un canal por @usuario o id; comprueba que el bot puede publicar en él.</summary>
    public Task<SaveResponse> Save(TelegramChannelSaveRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<SaveResponse>(async () =>
        {
            string chatRef = NormalizeChat(request.Chat);
            if (chatRef.Length == 0) return SaveResponse.Fail("Escribe el @usuario del canal o su id (-100…).");

            var bot = await bots.GetAsync(request.CredentialId, cancellationToken);
            if (bot == null) return SaveResponse.Fail("El bot no existe. Añádelo primero en Ajustes › Plataformas.");

            var me = await telegram.GetMeAsync(bot.BaseUrl, bot.Token, cancellationToken);
            if (!me.Ok) return SaveResponse.Fail(TelegramPublisher.Friendly(me.Error!));

            var chat = await telegram.GetChatAsync(bot.BaseUrl, bot.Token, chatRef, cancellationToken);
            if (!chat.Ok) return SaveResponse.Fail(TelegramPublisher.Friendly(chat.Error!));
            if (chat.Data!.Type is not ("channel" or "supergroup" or "group"))
                return SaveResponse.Fail("Eso no es un canal ni un grupo de Telegram.");

            var member = await telegram.GetChatMemberAsync(bot.BaseUrl, bot.Token, chat.Data.Id, me.Data!.Id, cancellationToken);
            if (!member.Ok) return SaveResponse.Fail(TelegramPublisher.Friendly(member.Error!));
            if (!member.Data!.CanPost)
                return SaveResponse.Fail($"@{me.Data.Username} no es administrador del canal con permiso «Publicar mensajes». Dáselo en Telegram y vuelve a intentarlo.");

            var saved = await connections.Save(new ConnectionSave(
                Platforms.Telegram,
                $"TG-{Guid.NewGuid():N}",
                chat.Data.Id,
                chat.Data.Title,
                null,
                chat.Data.Username is { } u ? $"@{u}" : "Canal privado",
                null,
                null,
                null,
                userName,
                request.CredentialId), cancellationToken);

            await notifier.ConnectionChangedAsync(Platforms.Telegram, cancellationToken);
            return SaveResponse.Ok(new AccountSaveResult { Name = chat.Data.Title, ConnectionId = saved?.Id, IsNew = saved?.IsNew ?? false });
        });

    /// <summary>Acepta @canal, t.me/canal, https://t.me/canal o un id numérico.</summary>
    public static string NormalizeChat(string? value)
    {
        string chat = (value ?? string.Empty).Trim();
        foreach (string prefix in new[] { "https://t.me/", "http://t.me/", "t.me/" })
            if (chat.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) chat = chat[prefix.Length..];
        chat = chat.Split('/', '?')[0];
        if (chat.Length == 0 || long.TryParse(chat, out _)) return chat;
        return chat.StartsWith('@') ? chat : $"@{chat}";
    }
}
