using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Domain.Constants;

namespace YoutubeMeta.Tests;

/// <summary>Cada transición de la cola: qué estado queda y qué se limpia.</summary>
public class PublicationOutcomesTests
{
    private static readonly DateTime Now = new(2026, 11, 15, 12, 0, 0, DateTimeKind.Utc);
    private const int Backoff = 5;

    private static AttemptContext Upload(int attempts = 1, int max = 5) => new(Platforms.Facebook, attempts, max, 0, IsPoll: false);
    private static AttemptContext Poll(int pollCount = 0, int attempts = 1, int max = 5) => new(Platforms.Instagram, attempts, max, pollCount, IsPoll: true);

    [Fact]
    public void Lease_lost_writes_nothing() =>
        Assert.Null(PublicationOutcomes.ToResult(PublishStep.LeaseLost(), Upload(), Backoff, Now));

    [Fact]
    public void Processing_starts_polling_and_clears_session()
    {
        var r = PublicationOutcomes.ToResult(PublishStep.Processing("v1", "https://x/v1"), Upload(), Backoff, Now)!;
        Assert.Equal(PublicationStatus.Processing, r.StatusCode);
        Assert.Equal("v1", r.ExternalId);
        Assert.Equal(Now + PublicationOutcomes.PollDelays[0], r.NextAttemptAt);
        Assert.True(r.ClearSession);
    }

    [Fact]
    public void Done_is_a_notification()
    {
        var r = PublicationOutcomes.ToResult(PublishStep.Done("https://x", "aviso"), Upload(), Backoff, Now)!;
        Assert.Equal(PublicationStatus.Done, r.StatusCode);
        Assert.True(r.IsNotification);
        Assert.Contains("aviso", r.EventMessage);
    }

    [Fact]
    public void Retry_backs_off_by_attempt()
    {
        var r = PublicationOutcomes.ToResult(PublishStep.Retry("X", "m"), Upload(attempts: 3), Backoff, Now)!;
        Assert.Equal(PublicationStatus.Pending, r.StatusCode);
        Assert.Equal(Now.AddMinutes(15), r.NextAttemptAt);
    }

    [Fact]
    public void Retry_fails_when_attempts_are_exhausted_and_explains_what_to_do()
    {
        var r = PublicationOutcomes.ToResult(PublishStep.Retry("X", "Error temporal."), Upload(attempts: 5, max: 5), Backoff, Now)!;
        Assert.Equal(PublicationStatus.Failed, r.StatusCode);
        Assert.Contains("Reintentar", r.ErrorMessage);
        Assert.True(r.IsNotification);
    }

    [Fact]
    public void Restart_uploads_again_from_scratch()
    {
        var r = PublicationOutcomes.ToResult(PublishStep.Restart("S", "Caducó."), Upload(attempts: 2), Backoff, Now)!;
        Assert.Equal(PublicationStatus.Pending, r.StatusCode);
        Assert.True(r.ClearSession);
        Assert.False(r.ClearExternal);
        Assert.Equal(Now + PublicationOutcomes.RestartDelay, r.NextAttemptAt);
    }

    [Fact]
    public void Restart_is_capped_so_it_never_loops_forever()
    {
        var r = PublicationOutcomes.ToResult(PublishStep.Restart("S", "Caducó."), Upload(attempts: 5, max: 5), Backoff, Now)!;
        Assert.Equal(PublicationStatus.Failed, r.StatusCode);
        Assert.Contains("Reintentar", r.ErrorMessage);
    }

    [Fact]
    public void Restart_while_polling_reuploads_and_forgets_the_old_external_id()
    {
        // Instagram descartó el contenedor (o caducó): se sube otra vez sin que el usuario haga nada.
        var r = PublicationOutcomes.ToResult(PublishStep.Restart("container:EXPIRED", "Caducó."), Poll(pollCount: 7), Backoff, Now)!;
        Assert.Equal(PublicationStatus.Pending, r.StatusCode);
        Assert.True(r.ClearExternal);
        Assert.True(r.ClearSession);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(9)]
    public void Errors_while_polling_never_reupload(int pollCount)
    {
        var r = PublicationOutcomes.ToResult(PublishStep.Retry("X", "m"), Poll(pollCount), Backoff, Now)!;
        Assert.Equal(PublicationStatus.Processing, r.StatusCode);
        Assert.Equal(Now + PublicationOutcomes.PollDelay(pollCount + 1), r.NextAttemptAt);
        Assert.True(r.IsPoll);
    }

    [Fact]
    public void Poll_delay_grows_and_caps() =>
        Assert.Equal(PublicationOutcomes.PollDelayMax, PublicationOutcomes.PollDelay(100));

    [Fact]
    public void Waiting_for_quota_keeps_the_upload_and_notifies()
    {
        var until = Now.AddHours(3);
        var r = PublicationOutcomes.ToResult(PublishStep.WaitQuota("Q", "Cuota.", until), Upload(), Backoff, Now)!;
        Assert.Equal(PublicationStatus.WaitingQuota, r.StatusCode);
        Assert.Equal(until, r.NextAttemptAt);
        Assert.False(r.ClearSession);
    }

    [Fact]
    public void Uncertain_result_goes_to_review_keeping_the_session()
    {
        var r = PublicationOutcomes.ToResult(PlatformPublisherBase.Unverifiable("Telegram"), Upload(), Backoff, Now)!;
        Assert.Equal(PublicationStatus.NeedsReview, r.StatusCode);
        Assert.False(r.ClearSession);
        Assert.True(r.IsNotification);
        Assert.Contains("Ya está publicado", r.ErrorMessage);
        Assert.Contains("Publicar de nuevo", r.ErrorMessage);
    }

    [Fact]
    public void Needs_reconnect_is_a_notification()
    {
        var r = PublicationOutcomes.ToResult(PublishStep.NeedsReconnect("T", "Reconecta."), Upload(), Backoff, Now)!;
        Assert.Equal(PublicationStatus.NeedsReconnect, r.StatusCode);
        Assert.True(r.IsNotification);
    }

    [Fact]
    public void Failed_clears_the_session()
    {
        var r = PublicationOutcomes.ToResult(PublishStep.Failed("F", "No."), Upload(), Backoff, Now)!;
        Assert.Equal(PublicationStatus.Failed, r.StatusCode);
        Assert.True(r.ClearSession);
    }

    [Fact]
    public void Done_keeps_the_first_comment_id()
    {
        var r = PublicationOutcomes.ToResult(PublishStep.Done("https://x", externalId: "urn:li:share:1") with { CommentId = "c1" }, Upload(), Backoff, Now)!;
        Assert.Equal(PublicationStatus.Done, r.StatusCode);
        Assert.Equal("c1", r.CommentExternalId);
        Assert.Equal("urn:li:share:1", r.ExternalId);
    }
}
