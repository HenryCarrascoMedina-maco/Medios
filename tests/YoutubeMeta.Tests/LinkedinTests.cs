using Microsoft.Extensions.Options;
using YoutubeMeta.Api.Application.Services;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Domain.Settings;
using YoutubeMeta.Api.Infrastructure.External.Linkedin;

namespace YoutubeMeta.Tests;

/// <summary>Formato del texto de LinkedIn, enlaces públicos firmados y aviso de versión de la API.</summary>
public class LinkedinTests
{
    [Theory]
    [InlineData("Hola mundo", "Hola mundo")]
    [InlineData("Precio (50%)", "Precio \\(50%\\)")]
    [InlineData("a_b *c* ~d~ [e] {f} <g> @h | i \\ j", "a\\_b \\*c\\* \\~d\\~ \\[e\\] \\{f\\} \\<g\\> \\@h \\| i \\\\ j")]
    [InlineData("#marketing", "{hashtag|\\#|marketing}")]
    [InlineData("Novedades #ventas y #año2026", "Novedades {hashtag|\\#|ventas} y {hashtag|\\#|año2026}")]
    [InlineData("C# no es hashtag", "C\\# no es hashtag")]
    public void Commentary_escapes_reserved_characters_and_converts_hashtags(string input, string expected) =>
        Assert.Equal(expected, LinkedinClient.Commentary(input));

    [Fact]
    public void Commentary_of_nothing_is_empty() => Assert.Equal(string.Empty, LinkedinClient.Commentary(null));

    private static MediaLinks Links(string baseUrl = "https://kaltrum.com") =>
        new(Options.Create(new AppSettings { PublicBaseUrl = baseUrl }), Options.Create(new SecuritySettings { SecretKey = "clave-de-pruebas-0123456789" }));

    [Fact]
    public void Public_links_round_trip_and_expire()
    {
        var links = Links();
        var now = DateTimeOffset.UtcNow;
        string url = links.PublicUrl(42, ".JPG", TimeSpan.FromHours(1), now)!;

        Assert.StartsWith("https://kaltrum.com/api/Media/Public/42.", url);
        Assert.EndsWith(".jpg", url);
        string token = url[(url.LastIndexOf('/') + 1)..];
        Assert.Equal(42, links.Read(token, now));
        Assert.Null(links.Read(token, now.AddHours(2)));
    }

    [Fact]
    public void Tampered_public_links_are_rejected()
    {
        var links = Links();
        string url = links.PublicUrl(42, "jpg")!;
        string token = url[(url.LastIndexOf('/') + 1)..];
        Assert.Null(links.Read("43" + token[2..]));
        Assert.Null(links.Read("basura"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("http://kaltrum.com")]
    public void No_public_links_without_an_https_address(string baseUrl)
    {
        var links = Links(baseUrl);
        Assert.False(links.IsAvailable);
        Assert.Null(links.PublicUrl(1, "jpg"));
    }

    [Theory]
    [InlineData("202610", 2026, 11, 1)]
    [InlineData("202501", 2026, 11, 22)]
    [InlineData("2026-10", 2026, 11, null)]
    public void Linkedin_version_age(string version, int year, int month, int? expected) =>
        Assert.Equal(expected, InsightsService.LinkedinVersionAgeMonths(version, new DateTime(year, month, 15)));
}
