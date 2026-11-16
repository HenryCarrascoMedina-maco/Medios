using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Domain.Entities;
using YoutubeMeta.Api.Domain.Settings;
using YoutubeMeta.Api.Infrastructure.RealTime;

namespace YoutubeMeta.Tests;

public class UploadHeartbeatTests
{
    private sealed class FakeLease : IPublicationLease
    {
        public Func<int> Extend { get; set; } = () => 1;
        public int Extends;
        public int Commits;

        public Task<int> LeaseExtend(long id, string leaseOwner, int leaseMinutes, long bytesSent, long totalBytes, int percent, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Extends);
            return Task.FromResult(Extend());
        }

        public Task<int> CommitMark(long id, string leaseOwner, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Commits);
            return Task.FromResult(1);
        }
    }

    private sealed class NullNotifier : IProgressNotifier
    {
        public Task NotifyAsync(string entity, object data, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private static readonly VideoPublishSettings Settings = new() { ProgressEverySeconds = 15, LeaseMinutes = 10 };
    private static PublicationDueItem Item => new() { Id = 7, SizeBytes = 1000 };

    private static UploadHeartbeat Create(FakeLease lease, FakeTimeProvider time) =>
        new(lease, new NullNotifier(), NullLogger.Instance, Item, "owner", Settings, CancellationToken.None, time);

    /// <summary>Avanza el reloj de latido en latido, dejando correr las continuaciones entre medias.</summary>
    private static async Task TickAsync(FakeTimeProvider time, int beats)
    {
        for (int i = 0; i < beats; i++)
        {
            time.Advance(TimeSpan.FromSeconds(Settings.ProgressEverySeconds));
            await Task.Delay(20);
        }
    }

    [Fact]
    public async Task Renews_the_lease_on_every_beat()
    {
        var lease = new FakeLease();
        var time = new FakeTimeProvider();
        await using (var heartbeat = Create(lease, time))
        {
            await TickAsync(time, 3);
            Assert.False(heartbeat.LeaseLost);
        }
        Assert.True(lease.Extends >= 3);
    }

    [Fact]
    public async Task Zero_rows_means_another_process_took_it()
    {
        var lease = new FakeLease { Extend = () => 0 };
        var time = new FakeTimeProvider();
        await using var heartbeat = Create(lease, time);
        await TickAsync(time, 1);
        Assert.True(heartbeat.LeaseLost);
        Assert.True(heartbeat.Token.IsCancellationRequested);
    }

    [Fact]
    public async Task A_database_error_does_not_stop_the_upload_or_throw_on_dispose()
    {
        int calls = 0;
        var lease = new FakeLease { Extend = () => ++calls == 1 ? throw new TimeoutException("SQL") : 1 };
        var time = new FakeTimeProvider();
        var heartbeat = Create(lease, time);

        await TickAsync(time, 3);
        Assert.False(heartbeat.LeaseLost);
        Assert.False(heartbeat.Token.IsCancellationRequested);
        Assert.True(lease.Extends >= 2);

        await heartbeat.DisposeAsync();
    }

    [Fact]
    public async Task Persistent_database_errors_give_up_before_the_lease_expires()
    {
        var lease = new FakeLease { Extend = () => throw new TimeoutException("SQL caído") };
        var time = new FakeTimeProvider();
        await using var heartbeat = Create(lease, time);

        // 10 min de lease - 1 min de margen = 9 min = 36 latidos de 15 s.
        await TickAsync(time, 37);
        Assert.True(heartbeat.LeaseLost);
        Assert.True(heartbeat.Token.IsCancellationRequested);
    }

    [Fact]
    public async Task Commit_mark_is_saved_once()
    {
        var lease = new FakeLease();
        await using var heartbeat = Create(lease, new FakeTimeProvider());
        await heartbeat.MarkCommittingAsync();
        await heartbeat.MarkCommittingAsync();
        Assert.True(heartbeat.Committing);
        Assert.Equal(1, lease.Commits);
    }
}
