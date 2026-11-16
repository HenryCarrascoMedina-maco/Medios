using Microsoft.Data.SqlClient;
using YoutubeMeta.Api.Domain.Constants;
using YoutubeMeta.Api.Domain.Entities;
using YoutubeMeta.Api.Domain.Requests;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Tests.Database;

/// <summary>Bandeja: entrada idempotente, eco de lo enviado, cola de envío con lease, contactos, retención e inicio.</summary>
[Collection(DatabaseCollection.Name)]
public class InboxProcedureTests(DatabaseFixture fixture)
{
    private readonly InboxRepository _inbox = new(fixture.Db);
    private static readonly string Owner = $"TEST:{Guid.NewGuid():N}"[..30];

    private Task<int> AccountAsync(string platform = Platforms.WhatsApp) => fixture.AccountAsync(platform);

    private static InboxIncoming Message(int connectionId, string conversation, string messageId, string direction = InboxDirections.In, string body = "Hola",
        DateTime? at = null) =>
        new(connectionId, InboxKinds.Direct, conversation, "Lucía", messageId, direction, at ?? DateTime.UtcNow, body, new InboxContact(conversation, "Lucía", "+51"));

    [DbFact]
    public async Task Ingest_is_idempotent_and_counts_unread_once()
    {
        int account = await AccountAsync();
        string person = Guid.NewGuid().ToString("N")[..10];

        var first = await _inbox.Ingest(Message(account, person, $"{person}-1"), CancellationToken.None);
        var again = await _inbox.Ingest(Message(account, person, $"{person}-1"), CancellationToken.None);

        Assert.True(first!.IsNew);
        Assert.False(again!.IsNew);
        Assert.Equal(first.MessageId, again.MessageId);
        var conversation = await _inbox.Conversation(first.ConversationId, CancellationToken.None);
        Assert.Equal((1, "Lucía", InboxConversationStatus.Open), (conversation!.UnreadCount, conversation.ContactName, conversation.StatusCode));
        Assert.NotNull(conversation.AwaitingSince);
    }

    [DbFact]
    public async Task Reply_goes_through_the_queue_and_the_webhook_echo_does_not_duplicate_it()
    {
        int account = await AccountAsync();
        string person = Guid.NewGuid().ToString("N")[..10];
        var incoming = await _inbox.Ingest(Message(account, person, $"{person}-in", at: DateTime.UtcNow.AddMinutes(-5)), CancellationToken.None);

        long id = await _inbox.MessageCreate(incoming!.ConversationId, InboxDirections.Out, "Sí, enviamos", null, null, "admin", CancellationToken.None);
        var due = await _inbox.SendDue(50, Owner, 5, CancellationToken.None);
        Assert.Contains(due, d => d.Id == id && d.ConversationExternalId == person && d.ContactExternalId == person);

        // El eco llega antes de que el job guarde el resultado: se une al mensaje en curso.
        await _inbox.Ingest(Message(account, person, $"{person}-out", InboxDirections.Out, "Sí, enviamos"), CancellationToken.None);
        Assert.Equal(incoming.ConversationId, await _inbox.SendResult(id, Owner, InboxMessageStatus.Sent, $"{person}-out", null, null, CancellationToken.None));
        await _inbox.StatusSave(Platforms.WhatsApp, $"{person}-out", InboxMessageStatus.Read, null, CancellationToken.None);

        var messages = await _inbox.Messages(incoming.ConversationId, new InboxMessageQuery(), CancellationToken.None);
        var reply = Assert.Single(messages, m => m.Direction == InboxDirections.Out);
        Assert.Equal((InboxMessageStatus.Read, $"{person}-out"), (reply.StatusCode, reply.ExternalId));
        var conversation = await _inbox.Conversation(incoming.ConversationId, CancellationToken.None);
        Assert.Null(conversation!.AwaitingSince);
        Assert.Equal(0, conversation.UnreadCount);
    }

    [DbFact]
    public async Task Interrupted_send_goes_to_review_and_can_be_marked_as_sent()
    {
        int account = await AccountAsync();
        string person = Guid.NewGuid().ToString("N")[..10];
        var incoming = await _inbox.Ingest(Message(account, person, $"{person}-in"), CancellationToken.None);
        long id = await _inbox.MessageCreate(incoming!.ConversationId, InboxDirections.Out, "Respuesta", null, null, "admin", CancellationToken.None);
        await _inbox.SendDue(50, Owner, 5, CancellationToken.None);

        // El proceso murió a mitad: el lease vence.
        await fixture.Execute("UPDATE dbo.Inbox_Messages SET LeaseUntil = DATEADD(MINUTE, -1, SYSUTCDATETIME()) WHERE Id = @Id", new { Id = id });
        await _inbox.SendDue(50, Owner, 5, CancellationToken.None);
        Assert.Equal(InboxMessageStatus.NeedsReview, (await _inbox.Message(id, CancellationToken.None))!.StatusCode);

        await _inbox.MessageResolve(id, InboxResolution.MarkSent, CancellationToken.None);
        Assert.Equal(InboxMessageStatus.Sent, (await _inbox.Message(id, CancellationToken.None))!.StatusCode);
        var error = await Assert.ThrowsAsync<SqlException>(() => _inbox.MessageResolve(id, InboxResolution.MarkSent, CancellationToken.None));
        Assert.Equal(50042, error.Number);
    }

    [DbFact]
    public async Task Notes_do_not_answer_and_conversations_filter_by_search_tag_and_status()
    {
        int account = await AccountAsync(Platforms.Telegram);
        string person = Guid.NewGuid().ToString("N")[..10];
        var incoming = await _inbox.Ingest(Message(account, person, $"{person}-in", body: $"Busco {person} urgente"), CancellationToken.None);
        await _inbox.MessageCreate(incoming!.ConversationId, InboxDirections.Note, "Cliente VIP", null, null, "admin", CancellationToken.None);
        await _inbox.ConversationUpdate(incoming.ConversationId, InboxConversationStatus.Pending, true, ["vip", "envíos"], CancellationToken.None);

        var found = Assert.Single(await _inbox.Conversations(new InboxConversationQuery { SearchTerm = person }, CancellationToken.None));
        Assert.Equal(["envíos", "vip"], found.TagList);
        Assert.Equal((InboxConversationStatus.Pending, 0), (found.StatusCode, found.UnreadCount));
        Assert.NotNull(found.AwaitingSince);
        Assert.Single(await _inbox.Conversations(new InboxConversationQuery { Tag = "vip", Status = InboxConversationStatus.Pending, SearchTerm = person }, CancellationToken.None));
        Assert.Empty(await _inbox.Conversations(new InboxConversationQuery { Status = InboxConversationStatus.Closed, SearchTerm = person }, CancellationToken.None));

        // Un mensaje nuevo reabre la conversación.
        await _inbox.Ingest(Message(account, person, $"{person}-in2"), CancellationToken.None);
        Assert.Equal(InboxConversationStatus.Open, (await _inbox.Conversation(incoming.ConversationId, CancellationToken.None))!.StatusCode);
    }

    [DbFact]
    public async Task Contacts_link_and_unlink_as_the_same_person()
    {
        int whatsapp = await AccountAsync();
        int telegram = await AccountAsync(Platforms.Telegram);
        string person = Guid.NewGuid().ToString("N")[..10];
        var a = await _inbox.Conversation((await _inbox.Ingest(Message(whatsapp, $"{person}-wa", $"{person}-1"), CancellationToken.None))!.ConversationId, CancellationToken.None);
        var b = await _inbox.Conversation((await _inbox.Ingest(Message(telegram, $"{person}-tg", $"{person}-2"), CancellationToken.None))!.ConversationId, CancellationToken.None);

        await _inbox.ContactLink(a!.ContactId!.Value, b!.ContactId, CancellationToken.None);
        var linked = Assert.Single((await _inbox.Contact(a.ContactId.Value, CancellationToken.None))!.Linked);
        Assert.Equal((b.ContactId, 1), (linked.Id, linked.Conversations));

        await _inbox.ContactLink(a.ContactId.Value, null, CancellationToken.None);
        Assert.Empty((await _inbox.Contact(b.ContactId!.Value, CancellationToken.None))!.Linked);
        var error = await Assert.ThrowsAsync<SqlException>(() => _inbox.ContactLink(a.ContactId.Value, a.ContactId.Value, CancellationToken.None));
        Assert.Equal(50043, error.Number);
    }

    [DbFact]
    public async Task Agenda_contact_is_found_by_phone_and_not_duplicated()
    {
        string phone = $"+519{Random.Shared.Next(10_000_000, 99_999_999)}";
        string name = $"Juan {Guid.NewGuid():N}"[..20];
        int id = await _inbox.ContactCreate(name, phone, "juan@empresa.com", "admin", CancellationToken.None);

        var contact = (await _inbox.Contact(id, CancellationToken.None))!.Contact;
        Assert.Equal((InboxAgenda.Platform, phone, "juan@empresa.com"), (contact.Platform, contact.Phone, contact.Email));
        Assert.Equal(id, Assert.Single(await _inbox.ContactSearch(new ContactSearchQuery { SearchTerm = phone[1..] }, CancellationToken.None)).Id);

        var error = await Assert.ThrowsAsync<SqlException>(() => _inbox.ContactCreate("Otro", phone, null, "admin", CancellationToken.None));
        Assert.Equal(50044, error.Number);
        Assert.Contains(name, error.Message);
    }

    [DbFact]
    public async Task Starting_a_whatsapp_conversation_links_it_to_the_agenda_and_reuses_it()
    {
        int whatsapp = await AccountAsync();
        string waId = $"519{Random.Shared.Next(10_000_000, 99_999_999)}";
        int agenda = await _inbox.ContactCreate("María", $"+{waId}", null, "admin", CancellationToken.None);

        long id = await _inbox.ConversationStart(whatsapp, waId, "María", $"+{waId}", agenda, CancellationToken.None);
        Assert.Equal(id, await _inbox.ConversationStart(whatsapp, waId, "María", $"+{waId}", agenda, CancellationToken.None));

        var conversation = await _inbox.Conversation(id, CancellationToken.None);
        Assert.Equal(("María", (DateTime?)null), (conversation!.ContactName, conversation.LastInboundAt));
        var linked = Assert.Single((await _inbox.Contact(agenda, CancellationToken.None))!.Linked);
        Assert.Equal((Platforms.WhatsApp, conversation.ContactId), (linked.Platform, linked.Id));

        // Cuando la persona contesta, el mensaje cae en la misma conversación.
        var reply = await _inbox.Ingest(Message(whatsapp, waId, $"{waId}-in"), CancellationToken.None);
        Assert.Equal(id, reply!.ConversationId);
    }

    [DbFact]
    public async Task Invite_links_the_person_once_and_only_while_valid()
    {
        int telegram = await AccountAsync(Platforms.Telegram);
        int agenda = await _inbox.ContactCreate("Pedro", null, null, "admin", CancellationToken.None);
        string code = InboxAgenda.NewInviteCode();
        var invite = await _inbox.InviteCreate(code, agenda, telegram, $"https://t.me/bot?start={code}", DateTime.UtcNow.AddDays(30), "admin", CancellationToken.None);
        Assert.Equal((Platforms.Telegram, (DateTime?)null), (invite!.Platform, invite.UsedAt));

        string person = Guid.NewGuid().ToString("N")[..10];
        Assert.False(await _inbox.InviteClaim(new InboxReferral(telegram, person, "inv-desconocido"), CancellationToken.None));
        Assert.True(await _inbox.InviteClaim(new InboxReferral(telegram, person, code), CancellationToken.None));
        Assert.False(await _inbox.InviteClaim(new InboxReferral(telegram, "otra-persona", code), CancellationToken.None));

        // Su mensaje llega a la cuenta que la invitación ya vinculó a la ficha.
        var incoming = await _inbox.Ingest(Message(telegram, person, $"{person}-1"), CancellationToken.None);
        var conversation = await _inbox.Conversation(incoming!.ConversationId, CancellationToken.None);
        var detail = (await _inbox.Contact(agenda, CancellationToken.None))!;
        Assert.Equal(conversation!.ContactId, Assert.Single(detail.Linked).Id);
        Assert.NotNull(Assert.Single(detail.Invites).UsedAt);

        string expired = InboxAgenda.NewInviteCode();
        await _inbox.InviteCreate(expired, agenda, telegram, "https://t.me/bot", DateTime.UtcNow.AddMinutes(-1), "admin", CancellationToken.None);
        Assert.False(await _inbox.InviteClaim(new InboxReferral(telegram, "tarde", expired), CancellationToken.None));
    }

    [DbFact]
    public async Task Raw_events_are_saved_once_and_leased_in_order()
    {
        string key = Guid.NewGuid().ToString("N");
        Assert.True(await _inbox.EventSave(Platforms.Telegram, $"bot1:{key}", """{"update_id":1}""", CancellationToken.None));
        Assert.False(await _inbox.EventSave(Platforms.Telegram, $"bot1:{key}", """{"update_id":1}""", CancellationToken.None));

        var due = await _inbox.EventsDue(500, Owner, 5, 5, CancellationToken.None);
        var mine = Assert.Single(due, e => e.EventKey == $"bot1:{key}");
        await _inbox.EventResult(mine.Id, Owner, InboxEventStatus.Done, null, null, CancellationToken.None);
        Assert.DoesNotContain(await _inbox.EventsDue(500, Owner, 5, 5, CancellationToken.None), e => e.Id == mine.Id);
        Assert.Contains("""{"update_id":1}""", await _inbox.EventsRecent(Platforms.Telegram, "bot1:", DateTime.UtcNow.AddMinutes(-1), CancellationToken.None));
    }

    [DbFact]
    public async Task Disabled_platform_cancels_what_was_pending()
    {
        int connectionId = await AccountAsync(Platforms.LinkedIn);
        long id = await fixture.Scalar<long>("""
            DECLARE @Now DATETIME2(3) = SYSUTCDATETIME();
            INSERT INTO dbo.Posts (Kind, Title, CreatedBy, CreatedAt) VALUES ('TEXT', N'Post', N'test', @Now);
            INSERT INTO dbo.Publications (PostId, ConnectionId, Target, Title, PrivacyStatus, MadeForKids, ContainsSyntheticMedia, ConsentAt, StatusCode, RequestedBy, RequestedAt)
            VALUES (SCOPE_IDENTITY(), @ConnectionId, 'LINKEDIN', N'Hola', 'public', 0, 0, @Now, 'PENDING', N'test', @Now);
            SELECT CAST(SCOPE_IDENTITY() AS BIGINT);
            """, new { ConnectionId = connectionId });

        Assert.True(await new PublicationRepository(fixture.Db).DisabledCancel([Platforms.LinkedIn], CancellationToken.None) >= 1);
        Assert.Equal("CANCELLED", await fixture.Scalar<string>("SELECT StatusCode FROM dbo.Publications WHERE Id = @Id", new { Id = id }));
    }

    [DbFact]
    public async Task Home_summary_and_stats_cover_the_week()
    {
        int account = await AccountAsync();
        string person = Guid.NewGuid().ToString("N")[..10];
        await _inbox.Ingest(Message(account, person, $"{person}-1"), CancellationToken.None);

        var (kpis, _, activity) = await _inbox.Home(DateTime.UtcNow.Date, DateTime.UtcNow.Date.AddDays(1), CancellationToken.None);
        Assert.True(kpis.Awaiting >= 1);
        Assert.Equal(7, activity.Count);
        Assert.True(activity[^1].Received >= 1);

        var (daily, platforms) = await _inbox.Stats(DateTime.UtcNow.Date.AddDays(-1), CancellationToken.None);
        Assert.NotEmpty(daily);
        Assert.Contains(platforms, p => p.Platform == Platforms.WhatsApp && p.Received >= 1);
        Assert.Contains(await _inbox.Accounts(CancellationToken.None), a => a.Id == account && a.SyncKey == $"WHATSAPP:{account}");
    }
}
