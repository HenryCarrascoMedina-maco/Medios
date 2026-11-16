using YoutubeMeta.Api.Domain.Constants;
using YoutubeMeta.Api.Domain.Requests;
using YoutubeMeta.Api.Domain.Responses;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Tests.Database;

/// <summary>Biblioteca filtrada, etiquetas, plantillas, calendario, reprogramación, resultados y salud.</summary>
[Collection(DatabaseCollection.Name)]
public class FeatureProcedureTests(DatabaseFixture fixture)
{
    private readonly VideoRepository _videos = new(fixture.Db);
    private readonly PublicationRepository _publications = new(fixture.Db);
    private readonly ContentRepository _content = new(fixture.Db);
    private readonly ActivityRepository _activity = new(fixture.Db);

    private async Task<(int VideoId, long PublicationId)> SeedAsync(string title, string? status = null, string target = "TELEGRAM",
        DateTimeOffset? publishAt = null, DateTime? completedAt = null)
    {
        int videoId = await fixture.MediaAsync(title: title);
        if (status is null) return (videoId, 0);
        return (videoId, await fixture.PublicationAsync(videoId, target, status, publishAt: publishAt, completedAt: completedAt));
    }

    [DbFact]
    public async Task Library_filters_by_status_tag_and_pages()
    {
        string marker = Guid.NewGuid().ToString("N")[..8];
        var (unpublished, _) = await SeedAsync($"{marker} sin publicar");
        var (published, _) = await SeedAsync($"{marker} publicado", "DONE", completedAt: DateTime.UtcNow);
        var (failed, _) = await SeedAsync($"{marker} fallido", "FAILED", completedAt: DateTime.UtcNow);
        await _videos.TagsSet([unpublished, failed], ["promo"], [], CancellationToken.None);

        async Task<IReadOnlyList<int>> Ids(string? status = null, string? tag = null, int? take = null) =>
            (await _videos.Page(new VideoListQuery { SearchTerm = marker, Status = status, Tag = tag, Take = take }, CancellationToken.None)).Select(v => v.Id).ToList();

        Assert.Equal([unpublished], await Ids("UNPUBLISHED"));
        Assert.Equal([published], await Ids("PUBLISHED"));
        Assert.Equal([failed], await Ids("ERROR"));
        Assert.Equal([failed, unpublished], await Ids(tag: "promo"));

        var page = await _videos.Page(new VideoListQuery { SearchTerm = marker, Take = 2 }, CancellationToken.None);
        Assert.Equal(2, page.Count);
        Assert.Equal(3, page[0].TotalCount);
    }

    [DbFact]
    public async Task Tags_can_be_added_and_removed_in_bulk()
    {
        var (a, _) = await SeedAsync("a");
        var (b, _) = await SeedAsync("b");
        await _videos.TagsSet([a, b], ["x", "y"], [], CancellationToken.None);
        await _videos.TagsSet([a], [], ["x"], CancellationToken.None);

        var item = (await _videos.Get(a, CancellationToken.None))!;
        Assert.Equal(["y"], item.Tags);
        Assert.Contains(await _videos.Tags(CancellationToken.None), t => t.Tag == "x" && t.VideoCount >= 1);
    }

    [DbFact]
    public async Task Only_one_default_template_and_unique_names()
    {
        string name = Guid.NewGuid().ToString("N")[..10];
        int first = await _content.TemplateSave(null, new TemplateSaveRequest { Name = name + "1", Title = "{titulo}", IsDefault = true }, "test", CancellationToken.None);
        int second = await _content.TemplateSave(null, new TemplateSaveRequest { Name = name + "2", Title = "{titulo}", IsDefault = true }, "test", CancellationToken.None);

        var templates = await _content.Templates(TemplateUsages.Publish, CancellationToken.None);
        Assert.Single(templates, t => t.IsDefault);
        Assert.True(templates.Single(t => t.Id == second).IsDefault);
        Assert.False(templates.Single(t => t.Id == first).IsDefault);

        await Assert.ThrowsAnyAsync<Microsoft.Data.SqlClient.SqlException>(() =>
            _content.TemplateSave(null, new TemplateSaveRequest { Name = name + "1", Title = "t" }, "test", CancellationToken.None));
        foreach (int id in new[] { first, second }) await _content.TemplateDelete(id, CancellationToken.None);
    }

    [DbFact]
    public async Task Reply_shortcuts_are_unique_and_a_reply_and_a_template_can_share_a_name()
    {
        string key = Guid.NewGuid().ToString("N")[..10];
        TemplateSaveRequest Reply(string name) => new() { Usage = TemplateUsages.Reply, Name = name, Shortcut = "atajo-" + key, Body = "Hola {nombre}" };

        int reply = await _content.TemplateSave(null, Reply(key), "test", CancellationToken.None);
        var error = await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(() => _content.TemplateSave(null, Reply(key + "b"), "test", CancellationToken.None));
        Assert.Equal(50044, error.Number);

        // El nombre es único por uso: una plantilla de publicación puede llamarse igual que una respuesta.
        int publish = await _content.TemplateSave(null, new TemplateSaveRequest { Name = key, Title = "{titulo}" }, "test", CancellationToken.None);

        var replies = await _content.Templates(TemplateUsages.Reply, CancellationToken.None);
        var saved = replies.Single(t => t.Id == reply);
        Assert.Equal("atajo-" + key, saved.Shortcut);
        Assert.Null(saved.Title);
        Assert.DoesNotContain(replies, t => t.Id == publish);

        foreach (int id in new[] { reply, publish }) await _content.TemplateDelete(id, CancellationToken.None);
    }

    [DbFact]
    public async Task Template_media_is_saved_in_order_replaced_and_kept_when_deleted_from_the_library()
    {
        string key = Guid.NewGuid().ToString("N")[..10];
        var (a, _) = await SeedAsync($"{key} a");
        var (b, _) = await SeedAsync($"{key} b");
        var request = new TemplateSaveRequest
        {
            Name = key, Body = "Promo", Platforms = ["instagram", "FACEBOOK"],
            Media = [new TemplateMediaRequest { MediaId = b, Alt = "Portada" }, new TemplateMediaRequest { MediaId = a }]
        };
        int id = await _content.TemplateSave(null, request, "test", CancellationToken.None);

        async Task<TemplateItem> Load() => (await _content.Templates(null, CancellationToken.None)).Single(t => t.Id == id);
        var template = await Load();
        Assert.Equal([b, a], template.Media.Select(m => m.MediaId));
        Assert.Equal("Portada", template.Media[0].AltText);
        Assert.Equal([Platforms.Instagram, Platforms.Facebook], template.PlatformList);

        // Se borra un archivo de la biblioteca: la plantilla lo conserva marcado y se puede volver a guardar con él.
        await _videos.Delete(a, "test", CancellationToken.None);
        template = await Load();
        Assert.True(template.Media.Single(m => m.MediaId == a).Missing);
        request.Media = [new TemplateMediaRequest { MediaId = a }];
        await _content.TemplateSave(id, request, "test", CancellationToken.None);
        Assert.Equal([a], (await Load()).Media.Select(m => m.MediaId));

        // Uno borrado que la plantilla no tenía no se puede añadir.
        var other = new TemplateSaveRequest { Name = key + "x", Body = "x", Media = [new TemplateMediaRequest { MediaId = a }] };
        await Assert.ThrowsAnyAsync<Microsoft.Data.SqlClient.SqlException>(() => _content.TemplateSave(null, other, "test", CancellationToken.None));

        Assert.Equal(1, await _content.TemplateUsed(id, CancellationToken.None));
        Assert.Equal(1, (await Load()).UseCount);
        Assert.Equal(1, await _content.TemplateDelete(id, CancellationToken.None));
    }

    [DbFact]
    public async Task Calendar_shows_scheduled_by_date_and_allows_moving_only_what_is_not_uploaded()
    {
        var day = new DateTimeOffset(2031, 3, 10, 15, 0, 0, TimeSpan.Zero);
        var (_, pending) = await SeedAsync("programado", "PENDING", "INSTAGRAM", publishAt: day);
        var (_, processing) = await SeedAsync("procesando", "PROCESSING", "INSTAGRAM", publishAt: day);

        var items = await _publications.Calendar(new DateTime(2031, 3, 1), new DateTime(2031, 4, 1), CancellationToken.None);
        Assert.True(items.Single(i => i.Id == pending).CanReschedule);
        Assert.False(items.Single(i => i.Id == processing).CanReschedule);

        var moved = await _publications.Reschedule(pending, day.AddDays(2), "test", CancellationToken.None);
        Assert.Equal(PublicationStatus.Pending, moved!.StatusCode);
        Assert.Equal(day.AddDays(2).UtcDateTime, (await _publications.Calendar(new DateTime(2031, 3, 1), new DateTime(2031, 4, 1), CancellationToken.None))
            .Single(i => i.Id == pending).When);

        await Assert.ThrowsAnyAsync<Microsoft.Data.SqlClient.SqlException>(() => _publications.Reschedule(processing, day.AddDays(3), "test", CancellationToken.None));
    }

    [DbFact]
    public async Task Rescheduling_a_youtube_video_makes_it_private_until_publish_time()
    {
        var (_, id) = await SeedAsync("yt", "PENDING", "YOUTUBE");
        await _publications.Reschedule(id, DateTimeOffset.UtcNow.AddDays(5), "test", CancellationToken.None);
        Assert.Equal("private", await fixture.Scalar<string>("SELECT PrivacyStatus FROM dbo.Publications WHERE Id = @id", new { id }));
        Assert.Equal("YOUTUBE", await _publications.TargetOf(id, CancellationToken.None));
    }

    [DbFact]
    public async Task Insights_and_metrics_roll_up_by_account()
    {
        var (_, done) = await SeedAsync("ok", "DONE", "YOUTUBE", completedAt: DateTime.UtcNow);
        await SeedAsync("ko", "FAILED", "YOUTUBE", completedAt: DateTime.UtcNow);
        await _activity.MetricsSave(done, new(120, 7, 2), CancellationToken.None);

        var (daily, accounts) = await _activity.Insights(DateTime.UtcNow.Date.AddDays(-1), CancellationToken.None);
        Assert.Contains(daily, d => d.Done >= 1 && d.Failed >= 1);
        Assert.Contains(accounts, a => a.Views == 120 && a.Likes == 7 && a.Published == 1);
    }

    [DbFact]
    public async Task Health_counts_reviews()
    {
        await SeedAsync("revisar", "NEEDS_REVIEW");
        var health = await _activity.Health(CancellationToken.None);
        Assert.True(health.NeedsReview >= 1);
    }
}
