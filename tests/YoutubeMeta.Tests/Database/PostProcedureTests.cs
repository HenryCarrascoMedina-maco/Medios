using YoutubeMeta.Api.Domain.Constants;
using YoutubeMeta.Api.Domain.Entities;
using YoutubeMeta.Api.Domain.Requests;
using YoutubeMeta.Api.Infrastructure.Repositories;
using static YoutubeMeta.Tests.TestData;

namespace YoutubeMeta.Tests.Database;

/// <summary>Posts con varios archivos o sin ninguno, contra SQL Server real.</summary>
[Collection(DatabaseCollection.Name)]
public class PostProcedureTests(DatabaseFixture fixture)
{
    private readonly PublicationRepository _publications = new(fixture.Db);
    private readonly VideoRepository _videos = new(fixture.Db);

    private Task<PublicationDueItem?> TakeAsync(string target, long id) => fixture.TakeAsync(target, id, "PRUEBAS:posts");

    [DbFact]
    public async Task A_text_post_has_no_media_and_is_queued_once_per_account()
    {
        int account = await fixture.AccountAsync(Platforms.LinkedIn);
        int postId = await _publications.PostCreate(PostKinds.Link, "Enlace", "https://kaltrum.com", [], "test", CancellationToken.None);
        long id = await _publications.Save(postId, null, Destination(account), "test", CancellationToken.None);

        var due = await TakeAsync(Platforms.LinkedIn, id);
        Assert.NotNull(due);
        Assert.Equal(PostKinds.Link, due.PostKind);
        Assert.Equal("https://kaltrum.com", due.LinkUrl);
        Assert.Empty(due.Media);
        Assert.Null(due.StoragePath);

        var again = await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(() =>
            _publications.Save(postId, null, Destination(account), "test", CancellationToken.None));
        Assert.Equal(50005, again.Number);
    }

    [DbFact]
    public async Task A_carousel_keeps_its_order_and_marks_every_image_as_published()
    {
        int a = await fixture.MediaAsync(MediaKinds.Image, "image/jpeg", "jpg");
        int b = await fixture.MediaAsync(MediaKinds.Image, "image/jpeg", "jpg");
        int c = await fixture.MediaAsync(MediaKinds.Image, "image/png", "png");
        int account = await fixture.AccountAsync(Platforms.Facebook);

        int postId = await _publications.PostCreate(PostKinds.Carousel, "Carrusel",
            null, [new() { Id = c }, new() { Id = a, Alt = "primera" }, new() { Id = b }], "test", CancellationToken.None);
        long id = await _publications.Save(postId, c, Destination(account), "test", CancellationToken.None);

        var due = await TakeAsync(Platforms.Facebook, id);
        Assert.Equal([c, a, b], due!.Media.Select(m => m.Id));

        await fixture.Execute("UPDATE dbo.Publications SET StatusCode = 'DONE', LeaseOwner = NULL WHERE Id = @id", new { id });
        // La segunda imagen no es el medio principal, pero su ficha también sale como publicada.
        var page = await _videos.Page(new VideoListQuery { Kind = MediaKinds.Image, Status = "PUBLISHED", Take = 200 }, CancellationToken.None);
        Assert.Contains(page, v => v.Id == a);
        Assert.All(page, v => Assert.Equal(MediaKinds.Image, v.MediaKind));

        // No se puede borrar un archivo que forma parte de una publicación en curso.
        await fixture.Execute("UPDATE dbo.Publications SET StatusCode = 'PENDING' WHERE Id = @id", new { id });
        var delete = await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(() => _videos.Delete(a, "test", CancellationToken.None));
        Assert.Equal(50003, delete.Number);
    }

    [DbFact]
    public async Task A_post_with_a_deleted_file_cannot_be_created()
    {
        int a = await fixture.MediaAsync(MediaKinds.Image, "image/jpeg", "jpg");
        await fixture.Execute("UPDATE dbo.Media_Assets SET StatusCode = 'DELETED' WHERE Id = @a", new { a });
        var ex = await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(() =>
            _publications.PostCreate(PostKinds.Image, "x", null, [new() { Id = a }], "test", CancellationToken.None));
        Assert.Equal(50002, ex.Number);
    }

    [DbFact]
    public async Task The_first_comment_is_stored_with_the_result_and_can_be_retried()
    {
        int account = await fixture.AccountAsync(Platforms.LinkedIn);
        int postId = await _publications.PostCreate(PostKinds.Text, "Texto", null, [], "test", CancellationToken.None);
        long id = await _publications.Save(postId, null, Destination(account, firstComment: "#hashtags"), "test", CancellationToken.None);
        Assert.NotNull(await TakeAsync(Platforms.LinkedIn, id));

        // Publicado pero sin comentario: queda pendiente.
        await _publications.Result(id, "PRUEBAS:posts", new PublicationResult(PublicationStatus.Done, "urn:li:share:1", "https://x",
            Warning: "sin comentario"), CancellationToken.None);
        var list = await _publications.List(new PublicationListQuery { Platform = Platforms.LinkedIn }, CancellationToken.None);
        var item = list.Single(p => p.Id == id);
        Assert.True(item.CommentPending);
        Assert.Equal(PostKinds.Text, item.PostKind);
        Assert.Null(item.VideoId);

        var row = await _publications.CommentGet(id, CancellationToken.None);
        Assert.Equal("urn:li:share:1", row!.ExternalId);

        await _publications.CommentSave(id, "urn:li:comment:9", "Primer comentario puesto.", CancellationToken.None);
        item = (await _publications.List(new PublicationListQuery { Platform = Platforms.LinkedIn }, CancellationToken.None)).Single(p => p.Id == id);
        Assert.False(item.CommentPending);
        Assert.Null(item.Warning);
    }
}
