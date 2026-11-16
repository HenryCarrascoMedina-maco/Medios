using YoutubeMeta.Api.Application.Services;
using YoutubeMeta.Api.Domain.Constants;
using YoutubeMeta.Api.Domain.Requests;
using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.External.Telegram;
using YoutubeMeta.Api.Infrastructure.External.Tiktok;

namespace YoutubeMeta.Tests;

public class PublicationRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 15, 0, 0, TimeSpan.Zero);
    private const long Mb = 1024 * 1024;

    private static PublicationDestination ValidYoutube() => new()
    {
        ConnectionId = 1,
        Title = "Presentación grifería",
        Description = "Descripción",
        Tags = "grifería, baño",
        CategoryId = "26",
        PrivacyStatus = PrivacyStatus.Public,
        MadeForKids = false,
        ContainsSyntheticMedia = false
    };

    private static string? Youtube(PublicationDestination d) => PublicationRules.Validate(Platforms.YouTube, d, Now);

    #region YOUTUBE Y FACEBOOK
    [Fact]
    public void Valid_youtube_destination_passes() => Assert.Null(Youtube(ValidYoutube()));

    [Fact]
    public void Description_is_measured_in_utf8_bytes()
    {
        var d = ValidYoutube();
        d.Description = new string('á', 2501); // 2501 caracteres, 5002 bytes
        Assert.NotNull(Youtube(d));

        d.Description = new string('á', 2500);
        Assert.Null(Youtube(d));
    }

    [Theory]
    [InlineData("a, b", 3)]
    [InlineData("dos palabras", 14)]
    [InlineData("uno, dos palabras", 18)]
    [InlineData("", 0)]
    public void Tags_length_matches_youtube(string tags, int expected) =>
        Assert.Equal(expected, PublicationRules.YoutubeTagsLength(tags));

    [Fact]
    public void Title_rejects_angle_brackets_and_more_than_100_chars()
    {
        var d = ValidYoutube();
        d.Title = "Hola <b>";
        Assert.NotNull(Youtube(d));

        d.Title = new string('x', 101);
        Assert.NotNull(Youtube(d));
    }

    [Fact]
    public void Privacy_and_declarations_are_required()
    {
        var d = ValidYoutube();
        d.PrivacyStatus = null;
        Assert.NotNull(Youtube(d));

        d = ValidYoutube();
        d.PrivacyStatus = PrivacyStatus.Followers; // solo existe en TikTok
        Assert.NotNull(Youtube(d));

        d = ValidYoutube();
        d.ContainsSyntheticMedia = null;
        Assert.NotNull(Youtube(d));
    }

    [Fact]
    public void Scheduled_youtube_video_must_be_private_and_future()
    {
        var d = ValidYoutube();
        d.PublishAt = Now.AddDays(1);
        Assert.NotNull(Youtube(d));

        d.PrivacyStatus = PrivacyStatus.Private;
        Assert.Null(Youtube(d));

        d.PublishAt = Now.AddMinutes(-1);
        Assert.NotNull(Youtube(d));
    }

    [Fact]
    public void Facebook_schedule_window_is_10_minutes_to_6_months()
    {
        var d = new PublicationDestination { ConnectionId = 1, Title = "Video" };
        Assert.Null(PublicationRules.Validate(Platforms.Facebook, d, Now));

        d.PublishAt = Now.AddMinutes(5);
        Assert.NotNull(PublicationRules.Validate(Platforms.Facebook, d, Now));

        d.PublishAt = Now.AddMinutes(15);
        Assert.Null(PublicationRules.Validate(Platforms.Facebook, d, Now));

        d.PublishAt = Now.AddMonths(7);
        Assert.NotNull(PublicationRules.Validate(Platforms.Facebook, d, Now));
    }
    #endregion

    #region INSTAGRAM, TELEGRAM Y TIKTOK
    [Fact]
    public void Instagram_caption_limits_hashtags_and_mentions()
    {
        var d = new PublicationDestination { ConnectionId = 1, Title = "Reel", Description = string.Join(' ', Enumerable.Range(1, 30).Select(i => $"#tag{i}")) };
        Assert.Null(PublicationRules.Validate(Platforms.Instagram, d, Now));

        d.Description += " #otro";
        Assert.NotNull(PublicationRules.Validate(Platforms.Instagram, d, Now));

        d.Description = new string('x', 2201);
        Assert.NotNull(PublicationRules.Validate(Platforms.Instagram, d, Now));
    }

    [Fact]
    public void Instagram_reels_are_300_mb_and_3_seconds_to_15_minutes()
    {
        Assert.Null(PublicationRules.ValidateMedia(Platforms.Instagram, 100 * Mb, 60, null));
        Assert.NotNull(PublicationRules.ValidateMedia(Platforms.Instagram, 301 * Mb, 60, null));
        Assert.NotNull(PublicationRules.ValidateMedia(Platforms.Instagram, 10 * Mb, 2, null));
        Assert.NotNull(PublicationRules.ValidateMedia(Platforms.Instagram, 10 * Mb, 16 * 60, null));
    }

    [Fact]
    public void Telegram_size_depends_on_the_bot_server()
    {
        Assert.Null(PublicationRules.ValidateMedia(Platforms.Telegram, 49 * Mb, 10, null));
        Assert.NotNull(PublicationRules.ValidateMedia(Platforms.Telegram, 51 * Mb, 10, null));
        Assert.Null(PublicationRules.ValidateMedia(Platforms.Telegram, 1500 * Mb, 10, 2000));
    }

    [Fact]
    public void Telegram_caption_falls_back_to_title_and_is_1024_chars()
    {
        Assert.Equal("Título", PublicationRules.TelegramCaption("Título", "  "));
        var d = new PublicationDestination { ConnectionId = 1, Title = "Video", Description = new string('x', 1025) };
        Assert.NotNull(PublicationRules.Validate(Platforms.Telegram, d, Now));
    }

    [Fact]
    public void Job_scheduled_platforms_need_a_future_date()
    {
        var d = new PublicationDestination { ConnectionId = 1, Title = "Video", PublishAt = Now.AddMinutes(-5) };
        Assert.NotNull(PublicationRules.Validate(Platforms.Telegram, d, Now));

        d.PublishAt = Now.AddMinutes(1);
        Assert.Null(PublicationRules.Validate(Platforms.Telegram, d, Now));
    }

    [Fact]
    public void Tiktok_privacy_is_chosen_and_branded_content_is_never_private()
    {
        var d = new PublicationDestination { ConnectionId = 1, Title = "Video" };
        Assert.NotNull(PublicationRules.Validate(Platforms.TikTok, d, Now));

        d.PrivacyStatus = PrivacyStatus.Private;
        Assert.Null(PublicationRules.Validate(Platforms.TikTok, d, Now));

        d.Options = new PublicationOptions { BrandContent = true };
        Assert.NotNull(PublicationRules.Validate(Platforms.TikTok, d, Now));

        // Como borrador no se elige privacidad: se decide en la app de TikTok.
        d.PrivacyStatus = null;
        d.Options = new PublicationOptions { TiktokMode = TiktokModes.Inbox };
        Assert.Null(PublicationRules.Validate(Platforms.TikTok, d, Now));
    }
    #endregion

    #region DETALLES DE PLATAFORMA
    [Theory]
    [InlineData(3L * 1024 * 1024, 1)]            // < 5 MB: un solo trozo
    [InlineData(100L * 1024 * 1024, 3)]          // 32 + 32 + 36
    [InlineData(64L * 1024 * 1024, 2)]
    public void Tiktok_chunks_follow_the_media_transfer_rules(long size, int expectedCount)
    {
        var chunks = TiktokChunks.For(size, 32);
        Assert.Equal(expectedCount, chunks.Count);
        Assert.Equal(size, Enumerable.Range(0, chunks.Count).Sum(chunks.Length));
        Assert.True(chunks.Length(chunks.Count - 1) <= 128L * 1024 * 1024);
    }

    [Theory]
    [InlineData("-1001234567890", null, 15, "https://t.me/c/1234567890/15")]
    [InlineData("-1001234567890", "micanal", 15, "https://t.me/micanal/15")]
    public void Telegram_message_links(string chatId, string? username, long messageId, string expected) =>
        Assert.Equal(expected, TelegramBotClient.MessageLink(chatId, username, messageId));

    [Theory]
    [InlineData("@micanal", "@micanal")]
    [InlineData("micanal", "@micanal")]
    [InlineData("https://t.me/micanal", "@micanal")]
    [InlineData("t.me/micanal/15", "@micanal")]
    [InlineData("-1001234567890", "-1001234567890")]
    public void Telegram_channel_reference_is_normalized(string input, string expected) =>
        Assert.Equal(expected, TelegramAccountService.NormalizeChat(input));

    [Fact]
    public void Platform_options_roundtrip_and_skip_empty_values()
    {
        Assert.Null(new PublicationOptions().ToJson());

        var options = new PublicationOptions { TiktokMode = TiktokModes.Inbox, DisableComment = true };
        var parsed = PublicationOptions.Parse(options.ToJson());
        Assert.True(parsed.IsTiktokInbox);
        Assert.True(parsed.DisableComment);
        Assert.DoesNotContain("isTiktokInbox", options.ToJson()!, StringComparison.OrdinalIgnoreCase);
    }
    #endregion
}
