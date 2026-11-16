using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using YoutubeMeta.Api.Application.Services;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Domain.Requests;
using YoutubeMeta.Api.Domain.Settings;
using YoutubeMeta.Api.Infrastructure.External.Tiktok;

namespace YoutubeMeta.Tests;

public class LoginThrottleTests
{
    private static (LoginThrottle Throttle, FakeTimeProvider Time) Create()
    {
        var time = new FakeTimeProvider();
        return (new LoginThrottle(TestData.Cache(), time), time);
    }

    [Fact]
    public void First_failures_are_free()
    {
        var (throttle, _) = Create();
        for (int i = 0; i < LoginThrottle.FreeAttempts - 1; i++) throttle.Failure("1.1.1.1");
        Assert.Null(throttle.RetryAfter("1.1.1.1"));
    }

    [Fact]
    public void Lockout_doubles_and_is_capped()
    {
        var (throttle, _) = Create();
        for (int i = 0; i < LoginThrottle.FreeAttempts; i++) throttle.Failure("ip");
        Assert.Equal(TimeSpan.FromMinutes(1), throttle.RetryAfter("ip"));
        throttle.Failure("ip");
        Assert.Equal(TimeSpan.FromMinutes(2), throttle.RetryAfter("ip"));
        for (int i = 0; i < 20; i++) throttle.Failure("ip");
        Assert.Equal(LoginThrottle.MaxLockout, throttle.RetryAfter("ip"));
    }

    [Fact]
    public void Lockout_expires_and_is_per_ip()
    {
        var (throttle, time) = Create();
        for (int i = 0; i < LoginThrottle.FreeAttempts; i++) throttle.Failure("attacker");
        Assert.NotNull(throttle.RetryAfter("attacker"));
        Assert.Null(throttle.RetryAfter("admin-pc"));
        time.Advance(TimeSpan.FromMinutes(2));
        Assert.Null(throttle.RetryAfter("attacker"));
    }

    [Fact]
    public void Success_resets()
    {
        var (throttle, _) = Create();
        for (int i = 0; i < 10; i++) throttle.Failure("ip");
        throttle.Success("ip");
        Assert.Null(throttle.RetryAfter("ip"));
    }
}

public class AuthServiceTests
{
    private static AuthService Create(out LoginThrottle throttle)
    {
        var settings = Options.Create(new AuthSettings
        {
            AdminUser = "admin",
            AdminPasswordHash = PasswordHasher.Hash("clave-de-prueba"),
            JwtKey = new string('k', 40),
            TokenHours = 12
        });
        throttle = new LoginThrottle(TestData.Cache(), TimeProvider.System);
        return new AuthService(settings, new JwtTokenService(settings), throttle);
    }

    [Fact]
    public async Task Valid_login_issues_a_token()
    {
        var auth = Create(out _);
        var result = await auth.Login(new LoginRequest { UserName = "ADMIN", Password = "clave-de-prueba" }, "ip");
        Assert.True(result.IsSuccess);
        Assert.False(string.IsNullOrEmpty(result.Data!.Token));
    }

    [Fact]
    public async Task Locked_ip_is_rejected_even_with_the_right_password()
    {
        var auth = Create(out var throttle);
        for (int i = 0; i < LoginThrottle.FreeAttempts; i++) throttle.Failure("ip");
        var result = await auth.Login(new LoginRequest { UserName = "admin", Password = "clave-de-prueba" }, "ip");
        Assert.False(result.IsSuccess);
        Assert.Contains("Demasiados intentos", result.Errors[0]);
    }

    [Fact]
    public void Refresh_only_for_the_current_user()
    {
        var auth = Create(out _);
        Assert.True(auth.Refresh(AuthService.AdminUserId, "admin").IsSuccess);
        Assert.False(auth.Refresh(99, "otro").IsSuccess);
    }
}

public class TusAndTokenTests
{
    [Theory]
    [InlineData(100, 100, false, 100)]
    [InlineData(100, 60, true, 60)]
    [InlineData(0, 0, false, 0)]
    [InlineData(5, 0, true, 0)]
    public async Task Copy_never_writes_more_than_declared(int sent, long limit, bool overflow, int written)
    {
        using var source = new MemoryStream(new byte[sent]);
        using var target = new MemoryStream();
        Assert.Equal(overflow, await VideoUploadService.CopyLimitedAsync(source, target, limit, CancellationToken.None));
        Assert.Equal(written, target.Length);
    }

    [Theory]
    [InlineData(400, "invalid_grant", true)]
    [InlineData(401, "access_token_invalid", true)]
    [InlineData(429, "rate_limit_exceeded", false)]
    [InlineData(500, "internal_error", false)]
    [InlineData(503, "x", false)]
    public void Only_real_rejections_force_a_reconnect(int status, string code, bool rejection) =>
        Assert.Equal(rejection, TiktokTokens.IsRejection(new TiktokError(code, "m", status)));
}
