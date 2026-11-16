using YoutubeMeta.Api.Application.Services;
using YoutubeMeta.Api.Domain.Constants;
using YoutubeMeta.Api.Domain.Entities;
using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.External.Teams;
using static YoutubeMeta.Tests.TestData;

namespace YoutubeMeta.Tests;

/// <summary>Teams: canales por Graph o por webhook, errores de Entra, mensaje y tarjeta, caducidad del secreto.</summary>
public class TeamsTests
{
    [Theory]
    [InlineData("webhook:abc", true)]
    [InlineData("8f1c…/19:x@thread.tacv2", false)]
    public void Webhook_channels_are_recognised(string externalId, bool webhook) =>
        Assert.Equal(webhook, Platforms.IsTeamsWebhook(Platforms.Teams, externalId));

    [Fact]
    public void Webhook_channels_admit_less_than_graph_channels()
    {
        var pdf = Pdf();
        var image = Image(2);

        Assert.Null(PlatformCapabilities.Validate(PlatformCapabilities.ForAccount(Platforms.Teams, "team/channel"), PostKinds.Document, [pdf], false));
        Assert.Contains("webhook", PlatformCapabilities.Validate(PlatformCapabilities.ForAccount(Platforms.Teams, "webhook:x"), PostKinds.Document, [pdf], false));
        Assert.Contains("App:PublicBaseUrl", PlatformCapabilities.Validate(PlatformCapabilities.TeamsWebhook, PostKinds.Image, [image], false));
        Assert.False(PlatformCapabilities.TeamsWebhook.FirstComment);
        Assert.True(PlatformCapabilities.For(Platforms.Teams).FirstComment);
    }

    [Theory]
    [InlineData("consent_required", "AADSTS65001: The user or administrator has not consented", "admin_consent")]
    [InlineData("invalid_request", "AADSTS50020: User account from identity provider does not exist in tenant", "personal_account")]
    [InlineData("access_denied", "The user has denied access", "access_denied")]
    [InlineData("server_error", "algo", "denied")]
    public void Entra_errors_get_a_reason_the_user_understands(string error, string description, string expected) =>
        Assert.Equal(expected, TeamsAccountService.ReasonFor(error, description));

    [Theory]
    [InlineData("https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x", true)]
    [InlineData("https://default123.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc", true)]
    [InlineData("http://prod-12.westus.logic.azure.com/workflows/abc", false)]
    [InlineData("https://kaltrum.webhook.office.com/webhookb2/abc", false)]
    [InlineData("https://ejemplo.com/hook", false)]
    public void Only_workflow_webhooks_are_accepted(string url, bool valid) =>
        Assert.Equal(valid, TeamsAccountService.ValidateWebhookUrl(url) is null);

    [Fact]
    public void Text_is_escaped_and_keeps_its_lines() =>
        Assert.Equal("<p>Hola &lt;b&gt;<br>mundo &amp; mas</p>", TeamsPublisher.Paragraphs("Hola <b>\r\nmundo & mas"));

    [Fact]
    public void Channel_ids_are_split_from_the_account()
    {
        var (team, channel) = TeamsPublisher.Split("8f1c-team/19:abc@thread.tacv2");
        Assert.Equal("8f1c-team", team);
        Assert.Equal("19:abc@thread.tacv2", channel);
    }

    [Fact]
    public void Webhook_card_has_title_text_images_and_link()
    {
        var item = new PublicationDueItem
        {
            Title = "Versión 2",
            Description = "Novedades",
            PostKind = PostKinds.Link,
            LinkUrl = "https://kaltrum.com",
            Target = Platforms.Teams
        };
        string json = System.Text.RegularExpressions.Regex.Unescape(TeamsPublisher.Card(item).ToJsonString());
        Assert.Contains("application/vnd.microsoft.card.adaptive", json);
        Assert.Contains("Versión 2", json);
        Assert.Contains("Novedades", json);
        Assert.Contains("Action.OpenUrl", json);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData(60, null)]
    [InlineData(20, false)]
    [InlineData(-1, true)]
    public void Teams_secret_expiry_is_warned_before_it_breaks(int? daysLeft, bool? isError)
    {
        var today = new DateTime(2026, 11, 15);
        var alert = InsightsService.TeamsSecretAlert(daysLeft is { } d ? today.AddDays(d) : null, today);
        Assert.Equal(isError, alert?.IsError);
    }

    [Fact]
    public void Admin_consent_link_points_to_the_tenant() =>
        Assert.Equal("https://login.microsoftonline.com/t-1/adminconsent?client_id=c-1", TeamsClient.AdminConsentUrl("t-1", "c-1"));
}
