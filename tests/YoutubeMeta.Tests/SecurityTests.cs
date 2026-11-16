using Microsoft.Extensions.Options;
using System.Security.Cryptography;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Domain.Settings;

namespace YoutubeMeta.Tests;

public class SecurityTests
{
    private const string Secret = "client-secret";

    [Fact]
    public void OAuthState_roundtrip_keeps_user_and_return_url()
    {
        long now = 1_000_000;
        string state = OAuthState.Create("youtube-account-state", 7, "/connections", now + 600, Secret);

        Assert.True(OAuthState.TryRead("youtube-account-state", state, Secret, now, out int userId, out string returnUrl, out _));
        Assert.Equal(7, userId);
        Assert.Equal("/connections", returnUrl);
    }

    [Fact]
    public void OAuthState_rejects_tampering_other_purpose_and_expiry()
    {
        long now = 1_000_000;
        string state = OAuthState.Create("youtube-account-state", 7, "/connections", now + 600, Secret);

        Assert.False(OAuthState.TryRead("youtube-account-state", state + "x", Secret, now, out _, out _, out _));
        Assert.False(OAuthState.TryRead("teams-account-state", state, Secret, now, out _, out _, out _));
        Assert.False(OAuthState.TryRead("youtube-account-state", state, Secret, now + 601, out _, out _, out string? error));
        Assert.Equal("expired", error);
    }

    [Theory]
    [InlineData("https://evil.com", null)]
    [InlineData("//evil.com", null)]
    [InlineData("/connections?tab=1", "/connections?tab=1")]
    [InlineData(null, "/")]
    public void SafeReturnUrl_only_allows_local_paths(string? input, string? expected) =>
        Assert.Equal(expected, OAuthState.SafeReturnUrl(input));

    [Fact]
    public void PasswordHasher_verifies_only_the_right_password()
    {
        string hash = PasswordHasher.Hash("Clave-Segura-1");
        Assert.True(PasswordHasher.Verify("Clave-Segura-1", hash));
        Assert.False(PasswordHasher.Verify("otra", hash));
        Assert.False(PasswordHasher.Verify("Clave-Segura-1", "basura"));
    }

    [Fact]
    public void SecretProtector_roundtrip_and_random_nonce()
    {
        var protector = new SecretProtector(Options.Create(new SecuritySettings { SecretKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) }));

        string a = protector.Protect("token");
        string b = protector.Protect("token");

        Assert.NotEqual(a, b);
        Assert.Equal("token", protector.Unprotect(a));
        Assert.Null(protector.UnprotectOrNull(null));
    }
}
