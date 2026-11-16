using Google;
using Google.Apis.Requests;
using System.Net;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Common;
using YoutubeMeta.Api.Infrastructure.External.Meta;
using YoutubeMeta.Api.Infrastructure.External.YouTube;

namespace YoutubeMeta.Tests;

public class ClassifierTests
{
    private static GoogleApiException YoutubeError(HttpStatusCode status, string reason) =>
        new("youtube", reason)
        {
            HttpStatusCode = status,
            Error = new RequestError { Code = (int)status, Message = reason, Errors = [new SingleError { Reason = reason }] }
        };

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, "quotaExceeded", PublishOutcome.WaitQuota)]
    [InlineData(HttpStatusCode.BadRequest, "uploadLimitExceeded", PublishOutcome.WaitQuota)]
    [InlineData(HttpStatusCode.Unauthorized, "authorizationRequired", PublishOutcome.NeedsReconnect)]
    [InlineData(HttpStatusCode.Forbidden, "insufficientPermissions", PublishOutcome.NeedsReconnect)]
    [InlineData(HttpStatusCode.NotFound, "notFound", PublishOutcome.Restart)]
    [InlineData(HttpStatusCode.ServiceUnavailable, "backendError", PublishOutcome.Retry)]
    [InlineData(HttpStatusCode.BadRequest, "invalidTitle", PublishOutcome.Failed)]
    public void Youtube_errors_map_to_one_action(HttpStatusCode status, string reason, PublishOutcome expected) =>
        Assert.Equal(expected, YoutubeErrorClassifier.Classify(YoutubeError(status, reason)).Outcome);

    [Fact]
    public void Youtube_quota_waits_until_pacific_midnight()
    {
        var step = YoutubeErrorClassifier.Classify(YoutubeError(HttpStatusCode.Forbidden, "quotaExceeded"));
        Assert.True(step.NextAttemptAt > DateTime.UtcNow);
        Assert.True(step.NextAttemptAt <= DateTime.UtcNow.AddHours(25));
    }

    [Fact]
    public void Network_errors_are_retried() =>
        Assert.Equal(PublishOutcome.Retry, YoutubeErrorClassifier.Classify(new HttpRequestException("reset")).Outcome);

    [Theory]
    [InlineData(190, null, PublishOutcome.NeedsReconnect)]
    [InlineData(200, null, PublishOutcome.NeedsReconnect)]
    [InlineData(80001, null, PublishOutcome.WaitQuota)]
    [InlineData(6001, 1363030, PublishOutcome.Retry)]
    [InlineData(6000, 1363041, PublishOutcome.Restart)]
    [InlineData(6000, 1363023, PublishOutcome.Failed)]
    [InlineData(368, null, PublishOutcome.Failed)]
    public void Meta_errors_map_to_one_action(int code, int? subcode, PublishOutcome expected) =>
        Assert.Equal(expected, MetaErrorClassifier.Classify(new MetaError(code, subcode, "x", false, null, null)).Outcome);

    [Fact]
    public void Meta_rate_limit_uses_regain_access_minutes()
    {
        var step = MetaErrorClassifier.Classify(new MetaError(80001, null, "x", false, null, 30));
        Assert.InRange(step.NextAttemptAt!.Value, DateTime.UtcNow.AddMinutes(29), DateTime.UtcNow.AddMinutes(31));
    }

    [Theory]
    [InlineData("bytes=0-", 100_000_000, 10_485_760, 0, 10_485_759)]
    [InlineData("bytes=50000000-", 100_000_000, 10_485_760, 50_000_000, 60_485_759)]
    [InlineData("bytes=99999990-", 100_000_000, 10_485_760, 99_999_990, 99_999_999)]
    [InlineData("bytes=10-20", 100_000_000, 10_485_760, 10, 20)]
    [InlineData("bytes=-500", 1000, 10_485_760, 500, 999)]
    public void Open_ranges_are_cut_into_chunks(string header, long size, int chunk, long expectedStart, long expectedEnd)
    {
        Assert.True(FileRangeHelper.TryParseVideoChunkedRange(header, size, chunk, out long start, out long end));
        Assert.Equal(expectedStart, start);
        Assert.Equal(expectedEnd, end);
    }

    [Fact]
    public void Range_beyond_file_is_not_satisfiable() =>
        Assert.False(FileRangeHelper.TryParseVideoChunkedRange("bytes=2000-", 1000, 100, out _, out _));
}
