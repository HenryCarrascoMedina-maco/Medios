using YoutubeMeta.Api.Domain.Constants;
using YoutubeMeta.Api.Domain.Entities;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Tests.Database;

/// <summary>La cola contra SQL Server real: lease, intentos, marca del paso irreversible y resolución a mano.</summary>
[Collection(DatabaseCollection.Name)]
public class QueueProcedureTests(DatabaseFixture fixture)
{
    private readonly PublicationRepository _publications = new(fixture.Db);

    private async Task<long> SeedAsync(string status = "PENDING", string target = "TELEGRAM", string? externalId = null,
        string? errorCode = null, int attempts = 0) =>
        await fixture.PublicationAsync(await fixture.MediaAsync(), target, status, externalId, errorCode, attempts);

    private Task<PublicationDueItem?> TakeAsync(string target, long id, string owner) => fixture.TakeAsync(target, id, owner);

    private Task<string> StatusOf(long id) => fixture.Scalar<string>("SELECT StatusCode FROM dbo.Publications WHERE Id = @id", new { id });

    [DbFact]
    public async Task Only_one_process_takes_a_row_even_when_racing()
    {
        long id = await SeedAsync(target: "TIKTOK");

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(i =>
            _publications.DueList("TIKTOK", 1, $"owner-{i}", 10, CancellationToken.None)));

        Assert.Equal(1, results.Count(r => r.Any(x => x.Id == id)));
    }

    [DbFact]
    public async Task Resuming_after_waiting_for_quota_does_not_spend_an_attempt()
    {
        long id = await SeedAsync(status: "WAITING_QUOTA", target: "INSTAGRAM", attempts: 2);
        var taken = await TakeAsync("INSTAGRAM", id, "owner");
        Assert.Equal(2, taken!.Attempts);
    }

    [DbFact]
    public async Task Commit_mark_survives_a_crash_and_is_cleared_by_the_result()
    {
        long id = await SeedAsync(target: "FACEBOOK");
        await TakeAsync("FACEBOOK", id, "dead-process");
        Assert.Equal(1, await _publications.CommitMark(id, "dead-process", CancellationToken.None));

        // El proceso muere: el lease vence y otro proceso retoma la fila viendo la marca.
        await fixture.Execute("UPDATE dbo.Publications SET LeaseUntil = DATEADD(MINUTE, -1, SYSUTCDATETIME()) WHERE Id = @id", new { id });
        var retaken = (await TakeAsync("FACEBOOK", id, "new-process"))!;
        Assert.NotNull(retaken.CommitStartedAt);

        var row = await _publications.Result(id, "new-process", new PublicationResult(PublicationStatus.Processing, ExternalId: "v1", ClearSession: true), CancellationToken.None);
        Assert.Equal(1, row!.Affected);
        Assert.Equal(0, await fixture.Scalar<int>("SELECT COUNT(*) FROM dbo.Publications WHERE Id = @id AND CommitStartedAt IS NOT NULL", new { id }));
    }

    [DbFact]
    public async Task A_stale_owner_cannot_write_the_result()
    {
        long id = await SeedAsync(target: "YOUTUBE");
        await TakeAsync("YOUTUBE", id, "owner-a");
        var row = await _publications.Result(id, "owner-b", new PublicationResult(PublicationStatus.Done), CancellationToken.None);
        Assert.Equal(0, row!.Affected);
        Assert.Equal(PublicationStatus.Uploading, await StatusOf(id));
    }

    [DbFact]
    public async Task Restart_while_polling_clears_the_external_id()
    {
        long id = await SeedAsync(status: "PROCESSING", target: "INSTAGRAM", externalId: "container-1");
        await _publications.PollDueList(50, "poller", 2, CancellationToken.None);
        await _publications.Result(id, "poller", new PublicationResult(PublicationStatus.Pending, ClearSession: true, ClearExternal: true, IsPoll: true), CancellationToken.None);
        Assert.Equal(0, await fixture.Scalar<int>("SELECT COUNT(*) FROM dbo.Publications WHERE Id = @id AND ExternalId IS NOT NULL", new { id }));
        Assert.Equal(PublicationStatus.Pending, await StatusOf(id));
    }

    [DbFact]
    public async Task Review_can_be_marked_done_with_its_link()
    {
        long id = await SeedAsync(status: "NEEDS_REVIEW");
        var row = await _publications.Resolve(id, PublicationResolution.MarkDone, "https://t.me/canal/5", "test", CancellationToken.None);
        Assert.Equal(PublicationStatus.Done, row!.StatusCode);
        Assert.Equal("https://t.me/canal/5", await fixture.Scalar<string>("SELECT ExternalUrl FROM dbo.Publications WHERE Id = @id", new { id }));
    }

    [DbFact]
    public async Task Review_can_be_uploaded_again_from_scratch()
    {
        long id = await SeedAsync(status: "NEEDS_REVIEW", externalId: "x");
        var row = await _publications.Resolve(id, PublicationResolution.Reupload, null, "test", CancellationToken.None);
        Assert.Equal(PublicationStatus.Pending, row!.StatusCode);
        Assert.Equal(0, await fixture.Scalar<int>("SELECT Attempts FROM dbo.Publications WHERE Id = @id", new { id }));
    }

    [DbFact]
    public async Task Mark_done_is_only_for_reviews()
    {
        long id = await SeedAsync(status: "FAILED");
        await Assert.ThrowsAnyAsync<Microsoft.Data.SqlClient.SqlException>(() =>
            _publications.Resolve(id, PublicationResolution.MarkDone, null, "test", CancellationToken.None));
    }

    [DbFact]
    public async Task Retrying_a_processing_timeout_polls_again_instead_of_reuploading()
    {
        long id = await SeedAsync(status: "FAILED", target: "YOUTUBE", externalId: "abc123", errorCode: "PROCESSING_TIMEOUT");
        var row = await _publications.Retry(id, "test", CancellationToken.None);
        Assert.Equal(PublicationStatus.Processing, row!.StatusCode);
        Assert.Equal("abc123", await fixture.Scalar<string>("SELECT ExternalId FROM dbo.Publications WHERE Id = @id", new { id }));
    }

    [DbFact]
    public async Task Retrying_a_real_failure_uploads_again()
    {
        long id = await SeedAsync(status: "FAILED", target: "YOUTUBE", externalId: "abc123", errorCode: "invalidTitle");
        var row = await _publications.Retry(id, "test", CancellationToken.None);
        Assert.Equal(PublicationStatus.Pending, row!.StatusCode);
    }

    [DbFact]
    public async Task A_review_can_be_cancelled()
    {
        long id = await SeedAsync(status: "NEEDS_REVIEW");
        var row = await _publications.Cancel(id, "test", CancellationToken.None);
        Assert.Equal(PublicationStatus.Cancelled, row!.StatusCode);
    }

    [DbFact]
    public async Task Video_create_is_idempotent_by_storage_path()
    {
        var videos = new VideoRepository(fixture.Db);
        string path = $"videos/{Guid.NewGuid():N}.mp4";
        var row = new VideoRow { Title = "t", OriginalFileName = "a.mp4", StoragePath = path, ContentType = "video/mp4", SizeBytes = 10 };
        var metadata = new TusVideoMetadata { UserName = "test" };
        int first = await videos.Create(row, metadata, CancellationToken.None);
        int second = await videos.Create(row, metadata, CancellationToken.None);
        Assert.Equal(first, second);
    }

    [DbFact]
    public async Task Event_purge_keeps_the_last_event_and_unread_notices()
    {
        long id = await SeedAsync(status: "DONE");
        await fixture.Execute("""
            INSERT INTO dbo.Publication_Events (PublicationId, VideoId, Target, StatusCode, Message, IsNotification, IsRead, CreatedAt)
            SELECT P.Id, P.VideoId, P.Target, 'DONE', V.Msg, V.Noti, V.Readed, '2020-01-01'
            FROM dbo.Publications AS P
            CROSS JOIN (VALUES (N'viejo', 0, 1), (N'aviso sin leer', 1, 0), (N'último', 0, 1)) AS V (Msg, Noti, Readed)
            WHERE P.Id = @id
            """, new { id });

        await new ActivityRepository(fixture.Db).EventsPurge(new DateTime(2021, 1, 1), CancellationToken.None);

        var left = await fixture.Scalar<string>("SELECT STRING_AGG(Message, '|') WITHIN GROUP (ORDER BY Id) FROM dbo.Publication_Events WHERE PublicationId = @id", new { id });
        Assert.Equal("aviso sin leer|último", left);
    }
}
