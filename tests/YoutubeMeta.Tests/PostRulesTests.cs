using YoutubeMeta.Api.Domain.Constants;
using YoutubeMeta.Api.Domain.Rules;
using static YoutubeMeta.Tests.TestData;

namespace YoutubeMeta.Tests;

/// <summary>Tipo de post según sus archivos, qué admite cada plataforma y las reglas que dependen del tipo.</summary>
public class PostRulesTests
{
    public static TheoryData<MediaInfo[], string?, string?> Kinds => new()
    {
        { [], null, PostKinds.Text },
        { [], "https://kaltrum.com", PostKinds.Link },
        { [Image()], null, PostKinds.Image },
        { [Image(1), Image(2)], null, PostKinds.Carousel },
        { [Video()], null, PostKinds.Video },
        { [Pdf()], null, PostKinds.Document },
    };

    [Theory]
    [MemberData(nameof(Kinds))]
    public void Kind_is_inferred_from_files_and_link(MediaInfo[] media, string? link, string? expected) =>
        Assert.Equal(expected, PostRules.InferKind(media, link).Kind);

    [Fact]
    public void Kinds_cannot_be_mixed()
    {
        var (kind, error) = PostRules.InferKind([Image(), Video(2)], null);
        Assert.Null(kind);
        Assert.Contains("mezclar", error);
    }

    [Theory]
    [InlineData("ftp://x.com")]
    [InlineData("no es un enlace")]
    public void Link_must_be_http(string link) => Assert.Null(PostRules.InferKind([], link).Kind);

    [Fact]
    public void Link_goes_without_files() => Assert.Null(PostRules.InferKind([Image()], "https://kaltrum.com").Kind);

    [Fact]
    public void Only_one_video_or_pdf()
    {
        Assert.Null(PostRules.InferKind([Video(1), Video(2)], null).Kind);
        Assert.Null(PostRules.InferKind([Pdf(1), Pdf(2)], null).Kind);
    }

    [Theory]
    [InlineData(Platforms.YouTube, PostKinds.Text, false)]
    [InlineData(Platforms.YouTube, PostKinds.Video, true)]
    [InlineData(Platforms.Instagram, PostKinds.Text, false)]
    [InlineData(Platforms.LinkedIn, PostKinds.Document, true)]
    [InlineData(Platforms.Facebook, PostKinds.Document, false)]
    [InlineData(Platforms.Telegram, PostKinds.Link, true)]
    [InlineData(Platforms.TikTok, PostKinds.Link, false)]
    public void Each_platform_admits_its_kinds(string platform, string kind, bool admitted)
    {
        var media = PostKinds.HasMedia(kind) ? kind == PostKinds.Document ? new[] { Pdf() } : new[] { Video() } : [];
        Assert.Equal(admitted, PlatformCapabilities.Validate(platform, kind, media, publicMediaAvailable: true) is null);
    }

    [Fact]
    public void Instagram_needs_a_public_address_for_images()
    {
        Assert.Contains("App:PublicBaseUrl", PlatformCapabilities.Validate(Platforms.Instagram, PostKinds.Image, [Image()], false));
        Assert.Null(PlatformCapabilities.Validate(Platforms.Instagram, PostKinds.Image, [Image()], true));
        Assert.Null(PlatformCapabilities.Validate(Platforms.Facebook, PostKinds.Image, [Image()], false));
    }

    [Fact]
    public void Image_limits_are_checked()
    {
        var eleven = Enumerable.Range(1, 11).Select(i => Image(i)).ToArray();
        Assert.Contains("10", PlatformCapabilities.Validate(Platforms.Instagram, PostKinds.Carousel, eleven, true));
        Assert.Null(PlatformCapabilities.Validate(Platforms.LinkedIn, PostKinds.Carousel, eleven, true));
        Assert.Contains("JPEG", PlatformCapabilities.Validate(Platforms.Instagram, PostKinds.Image, [Image(type: "image/png")], true));
        Assert.Contains("MB", PlatformCapabilities.Validate(Platforms.Instagram, PostKinds.Image, [Image(size: 9L * 1024 * 1024)], true));
        Assert.Contains("2 imágenes", PlatformCapabilities.Validate(Platforms.Telegram, PostKinds.Carousel, [Image()], true));
    }

    [Fact]
    public void Linkedin_documents_have_a_size_limit() =>
        Assert.Contains("100 MB", PlatformCapabilities.Validate(Platforms.LinkedIn, PostKinds.Document, [Pdf(size: 101L * 1024 * 1024)], true));

    [Fact]
    public void Posts_without_files_need_text()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Equal("Escribe el texto de la publicación.", PublicationRules.Validate(Platforms.LinkedIn, Destination(description: null), now, PostKinds.Text));
        Assert.Null(PublicationRules.Validate(Platforms.LinkedIn, Destination(), now, PostKinds.Text));
        // Telegram usa el título si no hay texto.
        Assert.Null(PublicationRules.Validate(Platforms.Telegram, Destination(description: null), now, PostKinds.Text));
    }

    [Fact]
    public void Telegram_messages_admit_more_text_than_captions()
    {
        var now = DateTimeOffset.UtcNow;
        var d = Destination(description: new string('a', 2000));
        Assert.Null(PublicationRules.Validate(Platforms.Telegram, d, now, PostKinds.Text));
        Assert.NotNull(PublicationRules.Validate(Platforms.Telegram, d, now, PostKinds.Image));
    }

    [Fact]
    public void Linkedin_privacy_and_length()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Null(PublicationRules.Validate(Platforms.LinkedIn, Destination(privacy: PrivacyStatus.Connections), now, PostKinds.Text));
        Assert.NotNull(PublicationRules.Validate(Platforms.LinkedIn, Destination(privacy: PrivacyStatus.Unlisted), now, PostKinds.Text));
        Assert.NotNull(PublicationRules.Validate(Platforms.LinkedIn, Destination(description: new string('a', 3001)), now, PostKinds.Text));
    }

    [Fact]
    public void First_comment_only_where_the_platform_allows_it()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Null(PublicationRules.Validate(Platforms.LinkedIn, Destination(firstComment: "#hola"), now, PostKinds.Text));
        Assert.Contains("primer comentario", PublicationRules.Validate(Platforms.Telegram, Destination(firstComment: "#hola"), now, PostKinds.Text));
        Assert.Contains("1250", PublicationRules.Validate(Platforms.LinkedIn, Destination(firstComment: new string('a', 1251)), now, PostKinds.Text));
    }

    [Fact]
    public void Linkedin_video_limits()
    {
        Assert.NotNull(PublicationRules.ValidateMedia(Platforms.LinkedIn, 600L * 1024 * 1024, 60, null));
        Assert.NotNull(PublicationRules.ValidateMedia(Platforms.LinkedIn, 1024, 2, null));
        Assert.Null(PublicationRules.ValidateMedia(Platforms.LinkedIn, 1024, 60, null));
    }

    [Fact]
    public void Rules_describe_capabilities_for_the_front()
    {
        var info = PublicationRules.Describe(publicMediaAvailable: true);
        Assert.True(info.PublicMediaAvailable);
        Assert.Equal(Platforms.All.Length, info.Platforms.Count);
        Assert.True(info.Platforms[Platforms.LinkedIn].FirstComment);
    }

    [Theory]
    [InlineData("Primera línea\nsegunda", "Primera línea")]
    [InlineData(null, "Texto")]
    public void Title_is_derived_from_text_when_missing(string? text, string expected) =>
        Assert.Equal(expected, PostRules.TitleFromText(text, PostKinds.Text));

    [Fact]
    public void Derived_title_is_trimmed() =>
        Assert.Equal(PostRules.DerivedTitleMax, PostRules.TitleFromText(new string('a', 200), PostKinds.Text).Length);
}
