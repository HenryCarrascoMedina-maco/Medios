using YoutubeMeta.Api.Domain.Constants;
using YoutubeMeta.Api.Domain.Rules;

namespace YoutubeMeta.Tests;

public class ContentRulesTests
{
    [Theory]
    [InlineData("#Promo", "promo")]
    [InlineData("  Mi Etiqueta  ", "mi-etiqueta")]
    [InlineData("cocina!!", "cocina")]
    [InlineData("año_2026", "año_2026")]
    [InlineData("###", null)]
    [InlineData("", null)]
    public void Tags_are_normalized(string input, string? expected) =>
        Assert.Equal(expected, ContentRules.NormalizeTag(input));

    [Fact]
    public void Tags_are_deduplicated() =>
        Assert.Equal(["promo"], ContentRules.NormalizeTags(["Promo", "#promo", " PROMO "]));

    [Theory]
    [InlineData("cocina", true)]
    [InlineData("cocina_2", true)]
    [InlineData("Cocina", false)]
    [InlineData("con espacio", false)]
    [InlineData("", false)]
    public void Block_names_are_usable_as_placeholders(string name, bool valid) =>
        Assert.Equal(valid, ContentRules.IsValidBlockName(name));
}

public class ScheduleRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 15, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("FACEBOOK", 5, false)]       // menos de 10 min
    [InlineData("FACEBOOK", 15, true)]
    [InlineData("INSTAGRAM", 1, true)]
    [InlineData("YOUTUBE", 1, true)]
    public void Each_platform_has_its_window(string platform, int minutes, bool ok) =>
        Assert.Equal(ok, PublicationRules.ValidateSchedule(platform, Now.AddMinutes(minutes), Now) is null);

    [Fact]
    public void Past_dates_are_rejected_everywhere()
    {
        foreach (var platform in Platforms.All)
            Assert.NotNull(PublicationRules.ValidateSchedule(platform, Now.AddMinutes(-1), Now));
    }

    [Fact]
    public void Job_scheduled_platforms_allow_six_months()
    {
        Assert.Null(PublicationRules.ValidateSchedule(Platforms.Telegram, Now.AddMonths(6).AddMinutes(-1), Now));
        Assert.NotNull(PublicationRules.ValidateSchedule(Platforms.Telegram, Now.AddMonths(6).AddDays(1), Now));
        Assert.Null(PublicationRules.ValidateSchedule(Platforms.YouTube, Now.AddYears(1), Now));
    }

    [Fact]
    public void Rules_info_matches_the_constants()
    {
        var info = PublicationRules.Describe();
        Assert.Equal(PublicationRules.InstagramCaptionMax, info.InstagramCaptionMax);
        Assert.Equal(10, info.FacebookScheduleMinMinutes);
    }
}
