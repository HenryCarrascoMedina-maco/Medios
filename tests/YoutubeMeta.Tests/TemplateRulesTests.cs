using YoutubeMeta.Api.Domain.Constants;
using YoutubeMeta.Api.Domain.Requests;
using YoutubeMeta.Api.Domain.Rules;

namespace YoutubeMeta.Tests;

/// <summary>Plantillas propias: de publicación y respuestas de la bandeja (/atajo).</summary>
public class TemplateRulesTests
{
    private static TemplateSaveRequest Publish(string? title = "{titulo}", string? body = "Texto") =>
        new() { Usage = TemplateUsages.Publish, Name = "Lanzamiento", Title = title, Body = body };

    private static TemplateSaveRequest Reply(string? shortcut = "envio", string? body = "Hola {nombre}") =>
        new() { Usage = TemplateUsages.Reply, Name = "Envío", Shortcut = shortcut, Body = body };

    [Fact]
    public void Valid_templates_pass()
    {
        Assert.Null(TemplateRules.Validate(Publish()));
        Assert.Null(TemplateRules.Validate(Reply()));
    }

    [Theory]
    [InlineData("/Envío", "envío")]
    [InlineData("  precio ", "precio")]
    [InlineData("/", null)]
    [InlineData(null, null)]
    public void Shortcuts_are_normalized(string? input, string? expected) =>
        Assert.Equal(expected, TemplateRules.NormalizeShortcut(input));

    [Theory]
    [InlineData("con espacio")]
    [InlineData("")]
    [InlineData("a/b")]
    public void Replies_need_a_valid_shortcut(string shortcut) =>
        Assert.NotNull(TemplateRules.Validate(Reply(shortcut)));

    [Fact]
    public void Usage_must_be_known() =>
        Assert.NotNull(TemplateRules.Validate(new TemplateSaveRequest { Usage = "OTRO", Name = "x", Body = "y" }));

    [Fact]
    public void Empty_templates_are_rejected_but_media_alone_is_enough()
    {
        Assert.NotNull(TemplateRules.Validate(Publish(title: " ", body: " ")));
        Assert.NotNull(TemplateRules.Validate(Reply(body: "")));

        var withMedia = Reply(body: "");
        withMedia.Media.Add(new TemplateMediaRequest { MediaId = 1 });
        Assert.Null(TemplateRules.Validate(withMedia));
    }

    [Fact]
    public void Only_publish_templates_can_be_the_default()
    {
        var reply = Reply();
        reply.IsDefault = true;
        Assert.NotNull(TemplateRules.Validate(reply));
    }

    [Fact]
    public void Media_is_limited_and_not_repeated()
    {
        var many = Publish();
        many.Media.AddRange(Enumerable.Range(1, TemplateRules.MediaMax + 1).Select(id => new TemplateMediaRequest { MediaId = id }));
        Assert.NotNull(TemplateRules.Validate(many));

        var repeated = Publish();
        repeated.Media.AddRange([new TemplateMediaRequest { MediaId = 7 }, new TemplateMediaRequest { MediaId = 7 }]);
        Assert.NotNull(TemplateRules.Validate(repeated));
    }

    [Fact]
    public void Platforms_depend_on_usage()
    {
        var publishOnWhatsApp = Publish();
        publishOnWhatsApp.Platforms.Add(Platforms.WhatsApp);
        Assert.NotNull(TemplateRules.Validate(publishOnWhatsApp));

        var replyOnWhatsApp = Reply();
        replyOnWhatsApp.Platforms.AddRange(["whatsapp", "WHATSAPP"]);
        Assert.Null(TemplateRules.Validate(replyOnWhatsApp));
        Assert.Equal([Platforms.WhatsApp], TemplateRules.NormalizePlatforms(replyOnWhatsApp.Platforms));
    }

    [Fact]
    public void Reply_text_is_limited_to_the_largest_channel() =>
        Assert.NotNull(TemplateRules.Validate(Reply(body: new string('a', TemplateRules.ReplyBodyMax + 1))));
}
