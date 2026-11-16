using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using System.Security.Cryptography;
using System.Text;
using YoutubeMeta.Api.Application.Inbox;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Domain.Constants;
using YoutubeMeta.Api.Domain.Entities;
using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Domain.Settings;
using YoutubeMeta.Api.Infrastructure.Data;
using YoutubeMeta.Api.Infrastructure.External.Meta;
using YoutubeMeta.Api.Infrastructure.External.Teams;
using YoutubeMeta.Api.Infrastructure.External.Telegram;
using YoutubeMeta.Api.Infrastructure.External.WhatsApp;
using YoutubeMeta.Api.Infrastructure.External.YouTube;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Tests;

/// <summary>Bandeja: reglas de respuesta, firmas de los webhooks y lo que cada adaptador saca de un aviso real.</summary>
public class InboxTests
{
    private static readonly DateTime Now = new(2026, 11, 16, 12, 0, 0, DateTimeKind.Utc);
    private static readonly SecretProtector Protector = new(Options.Create(new SecuritySettings { SecretKey = Convert.ToBase64String(new byte[32]) }));

    #region REGLAS
    [Theory]
    [InlineData(Platforms.WhatsApp, InboxKinds.Direct, 23, InboxWindowState.Open)]
    [InlineData(Platforms.WhatsApp, InboxKinds.Direct, 25, InboxWindowState.Closed)]
    [InlineData(Platforms.Facebook, InboxKinds.Direct, 25, InboxWindowState.Closed)]
    [InlineData(Platforms.Telegram, InboxKinds.Direct, 500, InboxWindowState.Open)]
    [InlineData(Platforms.Instagram, InboxKinds.Comments, 500, InboxWindowState.Open)]
    public void Window_is_24h_only_for_direct_messages_on_meta(string platform, string kind, int hoursAgo, InboxWindowState expected) =>
        Assert.Equal(expected, InboxRules.Window(platform, kind, Now.AddHours(-hoursAgo), Now, humanAgentEnabled: false));

    [Fact]
    public void Human_agent_tag_extends_messenger_to_7_days_but_not_whatsapp()
    {
        Assert.Equal(InboxWindowState.HumanAgent, InboxRules.Window(Platforms.Facebook, InboxKinds.Direct, Now.AddDays(-3), Now, true));
        Assert.Equal(InboxWindowState.Closed, InboxRules.Window(Platforms.Facebook, InboxKinds.Direct, Now.AddDays(-8), Now, true));
        Assert.Equal(InboxWindowState.Closed, InboxRules.Window(Platforms.WhatsApp, InboxKinds.Direct, Now.AddDays(-3), Now, true));
    }

    private static InboxReplyCheck Reply(string platform, string kind, string? body = "Hola", int media = 0, bool privateReply = false,
        string? parent = null, string? template = null, int hoursAgo = 1) =>
        new(platform, kind, Now.AddHours(-hoursAgo), body, media, privateReply, parent, template);

    [Fact]
    public void Reply_validation_explains_each_limit()
    {
        Assert.Null(InboxRules.ValidateReply(Reply(Platforms.WhatsApp, InboxKinds.Direct), Now, false, false));
        Assert.Contains("plantilla", InboxRules.ValidateReply(Reply(Platforms.WhatsApp, InboxKinds.Direct, hoursAgo: 30), Now, false, false));
        Assert.Null(InboxRules.ValidateReply(Reply(Platforms.WhatsApp, InboxKinds.Direct, body: null, template: "aviso", hoursAgo: 30), Now, false, false));
        Assert.Contains("1000", InboxRules.ValidateReply(Reply(Platforms.Instagram, InboxKinds.Direct, new string('a', 1001)), Now, false, false));
        Assert.Contains("dirección pública", InboxRules.ValidateReply(Reply(Platforms.Facebook, InboxKinds.Direct, media: 1), Now, false, false));
        Assert.Null(InboxRules.ValidateReply(Reply(Platforms.Facebook, InboxKinds.Direct, media: 1), Now, false, true));
        Assert.Contains("responder con texto", InboxRules.ValidateReply(Reply(Platforms.YouTube, InboxKinds.Comments, media: 1), Now, false, true));
        Assert.Contains("Elige el comentario", InboxRules.ValidateReply(Reply(Platforms.Facebook, InboxKinds.Comments, privateReply: true), Now, false, false));
        Assert.Null(InboxRules.ValidateReply(Reply(Platforms.Facebook, InboxKinds.Comments, privateReply: true, parent: "c1", hoursAgo: 100), Now, false, false));
        Assert.Contains("Escribe", InboxRules.ValidateReply(Reply(Platforms.Telegram, InboxKinds.Direct, body: " "), Now, false, false));
    }

    [Fact]
    public void Conversation_we_started_only_takes_a_template_until_the_person_writes()
    {
        Assert.True(InboxRules.WindowNeverOpened(Platforms.WhatsApp, InboxKinds.Direct, null));
        Assert.False(InboxRules.WindowNeverOpened(Platforms.Telegram, InboxKinds.Direct, null));
        Assert.Equal(InboxWindowState.Closed, InboxRules.Window(Platforms.WhatsApp, InboxKinds.Direct, null, Now, true));
        Assert.Equal(InboxWindowState.Open, InboxRules.Window(Platforms.Telegram, InboxKinds.Direct, null, Now, false));

        var neverOpened = new InboxReplyCheck(Platforms.WhatsApp, InboxKinds.Direct, null, "Hola", 0, false, null, null);
        Assert.Contains("aún no ha escrito", InboxRules.ValidateReply(neverOpened, Now, false, false));
        Assert.Null(InboxRules.ValidateReply(neverOpened with { Body = null, TemplateName = "bienvenida" }, Now, false, false));
    }

    [Theory]
    [InlineData("+51 987 654 321", "+51987654321")]
    [InlineData("0051-987-654-321", "+51987654321")]
    [InlineData("+1 (415) 555-0100", "+14155550100")]
    [InlineData("987654321", null)]
    [InlineData("+51 98x 654 321", null)]
    [InlineData("+0 987 654 321", null)]
    [InlineData("+123", null)]
    [InlineData(" ", null)]
    public void Phones_need_the_country_code(string value, string? expected) => Assert.Equal(expected, InboxRules.NormalizePhone(value));

    [Fact]
    public void Invite_codes_are_ours_and_url_safe()
    {
        string code = InboxAgenda.NewInviteCode();
        Assert.True(InboxAgenda.IsInviteCode(code));
        Assert.Matches("^inv[a-f0-9]{16}$", code);
        Assert.NotEqual(code, InboxAgenda.NewInviteCode());
        Assert.False(InboxAgenda.IsInviteCode("inv"));
        Assert.False(InboxAgenda.IsInviteCode("promo"));
        Assert.False(InboxAgenda.IsInviteCode("inv-1"));
    }

    [Fact]
    public void Failed_sends_retry_until_max_attempts_and_doubts_go_to_review()
    {
        var settings = new InboxSettings { MaxAttempts = 3, BackoffSeconds = 30 };
        Assert.Equal(InboxMessageStatus.Sent, InboxProcessor.Outcome(PublishStep.Done(null, externalId: "x"), 1, settings).Status);
        var retry = InboxProcessor.Outcome(PublishStep.Retry("NET", "corte"), 1, settings);
        Assert.Equal(InboxMessageStatus.Queued, retry.Status);
        Assert.NotNull(retry.Next);
        Assert.Equal(InboxMessageStatus.Failed, InboxProcessor.Outcome(PublishStep.Retry("NET", "corte"), 3, settings).Status);
        Assert.Equal(InboxMessageStatus.NeedsReview, InboxProcessor.Outcome(PublishStep.NeedsReview("X", "duda"), 1, settings).Status);
        Assert.Equal(InboxMessageStatus.Failed, InboxProcessor.Outcome(PublishStep.NeedsReconnect("X", "token"), 1, settings).Status);
    }
    #endregion

    #region FIRMAS
    [Fact]
    public void Meta_signature_must_match_the_exact_body()
    {
        byte[] body = Encoding.UTF8.GetBytes("""{"object":"page","entry":[]}""");
        string header = "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes("app-secret"), body)).ToLowerInvariant();

        Assert.True(WebhookSignature.VerifyMeta(body, header, "app-secret"));
        Assert.False(WebhookSignature.VerifyMeta(body, header, "otro-secreto"));
        Assert.False(WebhookSignature.VerifyMeta(Encoding.UTF8.GetBytes("""{"object":"page"}"""), header, "app-secret"));
        Assert.False(WebhookSignature.VerifyMeta(body, null, "app-secret"));
        Assert.False(WebhookSignature.VerifyMeta(body, "sha256=zz", "app-secret"));
    }

    [Fact]
    public void Telegram_secret_is_per_bot_and_stable()
    {
        var signature = new WebhookSignature(Options.Create(new SecuritySettings { SecretKey = "clave-de-pruebas" }));
        string secret = signature.TelegramSecret(4);
        Assert.Equal(secret, signature.TelegramSecret(4));
        Assert.NotEqual(secret, signature.TelegramSecret(5));
        Assert.Matches("^[a-z0-9]+$", secret);
        Assert.True(signature.VerifyTelegram(4, secret));
        Assert.False(signature.VerifyTelegram(5, secret));
        Assert.False(signature.VerifyTelegram(4, null));
    }
    #endregion

    #region ADAPTADORES
    private sealed class NoHttp : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("Las pruebas no llaman a la red.");
    }

    private static readonly DbExecuter OfflineDb = TestData.Db("Server=sin-red");

    private static InboxChannelServices Services() => new(new ConnectionRepository(OfflineDb), Protector);

    private static MetaGraphClient Graph() => new(new NoHttp(), Options.Create(new MetaSettings()));

    private static InboxAccountRow Account(int id, string platform, string externalId, int? credentialId = null) => new()
    {
        Id = id,
        Platform = platform,
        ExternalId = externalId,
        Name = "Kaltrum",
        ConnectionKey = $"K{id}",
        StatusCode = ConnectionStatus.Connected,
        InboxDirect = true,
        InboxComments = true,
        CredentialId = credentialId
    };

    private static InboxEventRow Event(string platform, string payload, string key = "k") => new() { Id = 1, Platform = platform, EventKey = key, Payload = payload };

    [Fact]
    public async Task Facebook_entry_gives_messages_echoes_receipts_and_comments()
    {
        var cache = TestData.Cache();
        cache.Set($"inbox:profile:{Platforms.Facebook}:PSID9", new InboxContact("PSID9", "Lucía Pérez"));
        var channel = new FacebookInbox(Services(), Graph(), cache);
        string payload = """
            {"id":"PAGE1","time":1763300000000,
             "messaging":[
               {"sender":{"id":"PSID9"},"recipient":{"id":"PAGE1"},"timestamp":1763300000000,"message":{"mid":"m_1","text":"Hola","attachments":[{"type":"image","payload":{"url":"https://x/y.jpg"}}]}},
               {"sender":{"id":"PAGE1"},"recipient":{"id":"PSID9"},"timestamp":1763300005000,"message":{"mid":"m_2","text":"¿En qué te ayudo?","is_echo":true}},
               {"sender":{"id":"PSID9"},"recipient":{"id":"PAGE1"},"delivery":{"mids":["m_2"]}}],
             "changes":[{"field":"feed","value":{"item":"comment","verb":"add","comment_id":"P_C1","post_id":"PAGE1_POST","parent_id":"PAGE1_POST",
                         "from":{"id":"U5","name":"Ana"},"message":"¿Precio?","created_time":1763300100}}]}
            """;

        var updates = await channel.ParseAsync(Event(Platforms.Facebook, payload), [Account(1, Platforms.Facebook, "PAGE1")], CancellationToken.None);

        var incoming = updates.OfType<InboxIncoming>().ToList();
        Assert.Equal(3, incoming.Count);
        Assert.Equal((InboxKinds.Direct, "PSID9", InboxDirections.In, "Lucía Pérez"), (incoming[0].Kind, incoming[0].ConversationExternalId, incoming[0].Direction, incoming[0].Contact!.Name));
        Assert.Equal("image", Assert.Single(incoming[0].Attachments).Kind);
        Assert.Equal((InboxDirections.Out, "PSID9"), (incoming[1].Direction, incoming[1].ConversationExternalId));
        Assert.Equal((InboxKinds.Comments, "PAGE1_POST", "Ana"), (incoming[2].Kind, incoming[2].ConversationExternalId, incoming[2].AuthorName));
        Assert.Null(incoming[2].ParentExternalId);
        Assert.Equal(InboxMessageStatus.Delivered, Assert.Single(updates.OfType<InboxStatusChange>()).Status);
    }

    [Fact]
    public async Task Entries_of_unknown_or_switched_off_accounts_are_ignored()
    {
        var channel = new FacebookInbox(Services(), Graph(), TestData.Cache());
        string payload = """{"id":"OTRA","changes":[{"field":"feed","value":{"item":"comment","verb":"add","comment_id":"c","post_id":"p","from":{"id":"u"}}}]}""";
        Assert.Empty(await channel.ParseAsync(Event(Platforms.Facebook, payload), [Account(1, Platforms.Facebook, "PAGE1")], CancellationToken.None));

        var off = Account(1, Platforms.Facebook, "OTRA");
        off.InboxComments = false;
        Assert.Empty(await channel.ParseAsync(Event(Platforms.Facebook, payload), [off], CancellationToken.None));
    }

    [Fact]
    public async Task Instagram_comment_keeps_its_parent_and_handle()
    {
        var channel = new InstagramInbox(Services(), Graph(), TestData.Cache());
        string payload = """{"id":"IG1","time":1763300000,"changes":[{"field":"comments","value":{"id":"C9","text":"Wow","from":{"id":"X","username":"marco"},"media":{"id":"MEDIA1"},"parent_id":"C1"}}]}""";

        var comment = Assert.IsType<InboxIncoming>(Assert.Single(await channel.ParseAsync(Event(Platforms.Instagram, payload), [Account(2, Platforms.Instagram, "IG1")], CancellationToken.None)));
        Assert.Equal(("MEDIA1", "@marco", "C1", InboxDirections.In), (comment.ConversationExternalId, comment.AuthorName, comment.ParentExternalId, comment.Direction));
    }

    [Fact]
    public async Task WhatsApp_change_gives_message_with_attachment_and_read_receipt()
    {
        var graph = Graph();
        var channel = new WhatsAppInbox(Services(), new WhatsAppClient(graph, new NoHttp()), graph);
        string payload = """
            {"id":"WABA","changes":[{"field":"messages","value":{"metadata":{"phone_number_id":"PHONE1"},
              "contacts":[{"wa_id":"51999","profile":{"name":"Lucía"}}],
              "messages":[{"from":"51999","id":"wamid.A","timestamp":"1763300000","type":"image","image":{"id":"MID","mime_type":"image/jpeg","caption":"Mira"}}],
              "statuses":[{"id":"wamid.B","status":"read"},{"id":"wamid.C","status":"failed","errors":[{"code":131047,"title":"Re-engagement"}]}]}}]}
            """;

        var updates = await channel.ParseAsync(Event(Platforms.WhatsApp, payload), [Account(3, Platforms.WhatsApp, "PHONE1")], CancellationToken.None);

        var message = Assert.Single(updates.OfType<InboxIncoming>());
        Assert.Equal(("51999", "Mira", "+51999"), (message.ConversationExternalId, message.Body, message.Contact!.Handle));
        Assert.Equal(("image", "MID"), (message.Attachments[0].Kind, message.Attachments[0].MediaId));
        var statuses = updates.OfType<InboxStatusChange>().ToList();
        Assert.Equal([InboxMessageStatus.Read, InboxMessageStatus.Failed], statuses.Select(s => s.Status));
        Assert.Contains("Re-engagement", statuses[1].Error);
    }

    [Fact]
    public void WhatsApp_errors_explain_the_24h_rule_and_wait_on_limits()
    {
        Assert.Equal(PublishOutcome.Failed, WhatsAppInbox.Classify(new MetaError(131047, null, "x", false, null, null)).Outcome);
        Assert.Equal(PublishOutcome.WaitQuota, WhatsAppInbox.Classify(new MetaError(130429, null, "x", false, null, null)).Outcome);
        Assert.Equal(3, WhatsAppClient.CountParams("Hola {{1}}, tu pedido {{2}} sale el {{3}}"));
        Assert.Equal(0, WhatsAppClient.CountParams("Sin variables"));
    }

    [Fact]
    public async Task Telegram_private_and_group_messages_go_to_the_bot_account()
    {
        var channel = Telegram();
        var accounts = new[] { Account(4, Platforms.Telegram, "-1001", credentialId: 7) };

        string privateMessage = """{"update_id":100,"message":{"message_id":5,"date":1763300000,"chat":{"id":777,"type":"private"},"from":{"id":777,"first_name":"Ana","username":"ana"},"text":"Hola"}}""";
        var direct = Assert.IsType<InboxIncoming>(Assert.Single(await channel.ParseAsync(Event(Platforms.Telegram, privateMessage, "bot7:100"), accounts, CancellationToken.None)));
        Assert.Equal((InboxKinds.Direct, "777", "Ana", "@ana"), (direct.Kind, direct.ConversationExternalId, direct.Contact!.Name, direct.Contact.Handle));

        string group = """{"update_id":101,"message":{"message_id":9,"date":1763300000,"chat":{"id":-1005,"type":"supergroup","title":"Comentarios"},"from":{"id":8,"first_name":"Luis"},"text":"Genial","reply_to_message":{"message_id":3}}}""";
        var comment = Assert.IsType<InboxIncoming>(Assert.Single(await channel.ParseAsync(Event(Platforms.Telegram, group, "bot7:101"), accounts, CancellationToken.None)));
        Assert.Equal((InboxKinds.Group, "Comentarios", "3"), (comment.Kind, comment.Title, comment.ParentExternalId));

        string forward = """{"update_id":102,"message":{"message_id":10,"date":1763300000,"chat":{"id":-1005,"type":"supergroup"},"is_automatic_forward":true,"text":"Post"}}""";
        Assert.Empty(await channel.ParseAsync(Event(Platforms.Telegram, forward, "bot7:102"), accounts, CancellationToken.None));
        Assert.Empty(await channel.ParseAsync(Event(Platforms.Telegram, privateMessage, "bot8:100"), accounts, CancellationToken.None));

        Assert.Equal(7, TelegramInbox.CredentialOf("bot7:100"));
        Assert.Null(TelegramInbox.CredentialOf("YT:1:2"));
    }

    private static TelegramInbox Telegram() =>
        new(Services(), new TelegramBotClient(new NoHttp()), new TelegramBots(new CredentialRepository(OfflineDb), Protector),
            new WebhookSignature(Options.Create(new SecuritySettings { SecretKey = "x" })), TestData.Cache());

    [Fact]
    public async Task Telegram_start_with_an_invite_links_the_person_and_hides_the_command()
    {
        string code = InboxAgenda.NewInviteCode();
        string start = $$$"""{"update_id":110,"message":{"message_id":6,"date":1763300000,"chat":{"id":777,"type":"private"},"from":{"id":777,"first_name":"Ana"},"text":"/start {{{code}}}"}}""";

        var updates = await Telegram().ParseAsync(Event(Platforms.Telegram, start, "bot7:110"), [Account(4, Platforms.Telegram, "-1001", credentialId: 7)], CancellationToken.None);

        Assert.Equal(new InboxReferral(4, "777", code), Assert.IsType<InboxReferral>(updates[0]));
        Assert.Equal(TelegramInbox.StartedWithInvite, Assert.IsType<InboxIncoming>(updates[1]).Body);
        Assert.Null(TelegramInbox.InviteCode("/start"));
        Assert.Null(TelegramInbox.InviteCode("/start promo-navidad"));
        Assert.Null(TelegramInbox.InviteCode($"Hola {code}"));
    }

    [Fact]
    public async Task Messenger_referral_links_the_person_before_the_message()
    {
        var cache = TestData.Cache();
        cache.Set($"inbox:profile:{Platforms.Facebook}:PSID9", new InboxContact("PSID9", "Lucía Pérez"));
        string code = InboxAgenda.NewInviteCode();
        string payload = $$$$"""
            {"id":"PAGE1","time":1763300000000,"messaging":[
              {"sender":{"id":"PSID9"},"recipient":{"id":"PAGE1"},"timestamp":1763300000000,"referral":{"ref":"{{{{code}}}}","source":"SHORTLINK","type":"OPEN_THREAD"}},
              {"sender":{"id":"PSID9"},"recipient":{"id":"PAGE1"},"timestamp":1763300001000,"postback":{"title":"Empezar","payload":"GET_STARTED","referral":{"ref":"otra-campaña"}}}]}
            """;

        var updates = await new FacebookInbox(Services(), Graph(), cache).ParseAsync(Event(Platforms.Facebook, payload), [Account(1, Platforms.Facebook, "PAGE1")], CancellationToken.None);

        Assert.Equal(new InboxReferral(1, "PSID9", code), Assert.Single(updates));
    }

    [Fact]
    public async Task Invite_links_point_to_the_account()
    {
        var instagram = Account(2, Platforms.Instagram, "IG1");
        instagram.AccountHint = "@kaltrum.pe · Kaltrum";
        Assert.Equal("https://ig.me/m/kaltrum.pe?ref=inv1", await new InstagramInbox(Services(), Graph(), TestData.Cache()).InviteLinkAsync(instagram, "inv1", CancellationToken.None));
        Assert.Equal("https://m.me/PAGE1?ref=inv1", await new FacebookInbox(Services(), Graph(), TestData.Cache()).InviteLinkAsync(Account(1, Platforms.Facebook, "PAGE1"), "inv1", CancellationToken.None));
        Assert.Null(InstagramInbox.Username(null));
        Assert.Null(InstagramInbox.Username("Kaltrum"));
    }

    [Fact]
    public void Telegram_chats_are_found_in_stored_updates()
    {
        var chats = TelegramBotClient.ChatsFromUpdates([
            """{"update_id":1,"my_chat_member":{"chat":{"id":-1001,"title":"Canal","type":"channel"}}}""",
            """{"update_id":2,"message":{"chat":{"id":5,"type":"private","first_name":"Ana"}}}""",
            "no-es-json"
        ]);
        Assert.Equal("-1001", Assert.Single(chats).Id);
    }

    [Fact]
    public void Youtube_thread_marks_the_channel_own_replies()
    {
        var payload = new YoutubeInbox.ThreadPayload("VID", "Tutorial 12",
        [
            new("T1", null, "Ana", "UC_otro", "¿Y en Linux?", Now),
            new("T1.R1", "T1", "Kaltrum", "UC_canal", "¡Sí!", Now.AddMinutes(5))
        ]);
        var updates = YoutubeInbox.ToUpdates(payload, Account(5, Platforms.YouTube, "UC_canal")).Cast<InboxIncoming>().ToList();

        Assert.Equal([InboxDirections.In, InboxDirections.Out], updates.Select(u => u.Direction));
        Assert.All(updates, u => Assert.Equal(("VID", "Tutorial 12", "VID"), (u.ConversationExternalId, u.Title, u.PublicationExternalId)));
        Assert.Equal("T1", updates[1].ParentExternalId);
    }

    [Theory]
    [InlineData("<p>Hola<br>equipo</p><p>&iquest;Sale hoy?</p>", "Hola\nequipo\n¿Sale hoy?")]
    [InlineData("<div><at id=\"0\">Ana</at> listo</div>", "Ana listo")]
    [InlineData(null, null)]
    public void Teams_html_becomes_plain_text(string? html, string? expected) => Assert.Equal(expected, TeamsInbox.PlainText(html));
    #endregion

    #region PLATAFORMAS DESACTIVADAS
    [Fact]
    public void Disabled_platforms_are_not_published_nor_connected()
    {
        var settings = new PlatformsSettings { Disabled = ["LINKEDIN"] };
        Assert.DoesNotContain(Platforms.LinkedIn, settings.Publishable);
        Assert.DoesNotContain(Platforms.LinkedIn, settings.Connectable);
        Assert.Contains(Platforms.WhatsApp, settings.Connectable);
        Assert.DoesNotContain(Platforms.WhatsApp, settings.Publishable);
        Assert.True(new PlatformsSettings().IsEnabled(Platforms.LinkedIn));
    }
    #endregion
}
