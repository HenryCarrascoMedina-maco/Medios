using System.Text.Json;
using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.Data;

namespace YoutubeMeta.Api.Infrastructure.Repositories;

/// <summary>Plantillas propias (con adjuntos) y bloques de hashtags.</summary>
public sealed class ContentRepository(DbExecuter db)
{
    /// <summary>Plantillas (todas o de un uso) con sus adjuntos en orden.</summary>
    public async Task<IReadOnlyList<TemplateItem>> Templates(string? usage, CancellationToken cancellationToken)
    {
        var (templates, media) = await db.Multiple<TemplateItem, TemplateMediaItem>("USP_TEMPLATE_LIST", new { Usage = usage }, cancellationToken);
        var byTemplate = media.ToLookup(m => m.TemplateId);
        foreach (var template in templates) template.Media = byTemplate[template.Id].ToList();
        return templates;
    }

    /// <summary>Guarda la plantilla ya validada (<see cref="TemplateRules.Validate"/>): lo que no aplica a su uso se guarda vacío.</summary>
    public Task<int> TemplateSave(int? id, TemplateSaveRequest r, string userName, CancellationToken cancellationToken)
    {
        bool publish = r.Usage == TemplateUsages.Publish;
        var platforms = TemplateRules.NormalizePlatforms(r.Platforms);
        return db.Single<int>("USP_TEMPLATE_SAVE", new
        {
            Id = id,
            r.Usage,
            Name = r.Name.Trim(),
            Shortcut = publish ? null : TemplateRules.NormalizeShortcut(r.Shortcut),
            Title = publish ? TextHelper.NullIfBlank(r.Title?.Trim()) : null,
            Body = TextHelper.NullIfBlank(r.Body?.TrimEnd()),
            Tags = publish ? TextHelper.NullIfBlank(r.Tags?.Trim()) : null,
            Platforms = platforms.Count == 0 ? null : string.Join(',', platforms),
            IsDefault = publish && r.IsDefault,
            Media = JsonSerializer.Serialize(r.Media.Select(m => new { id = m.MediaId, alt = m.Alt?.Trim() })),
            UserName = userName,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);
    }

    public Task<int> TemplateDelete(int id, CancellationToken cancellationToken) =>
        db.Single<int>("USP_TEMPLATE_DELETE", new { Id = id }, cancellationToken);

    public Task<int> TemplateUsed(int id, CancellationToken cancellationToken) =>
        db.Single<int>("USP_TEMPLATE_USED", new { Id = id, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task<IReadOnlyList<HashtagBlockItem>> HashtagBlocks(CancellationToken cancellationToken) =>
        db.Query<HashtagBlockItem>("USP_HASHTAG_BLOCK_LIST", null, cancellationToken);

    public Task<int> HashtagBlockSave(int? id, string name, string content, string userName, CancellationToken cancellationToken) =>
        db.Single<int>("USP_HASHTAG_BLOCK_SAVE", new { Id = id, Name = name, Content = content, UserName = userName, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task<int> HashtagBlockDelete(int id, CancellationToken cancellationToken) =>
        db.Single<int>("USP_HASHTAG_BLOCK_DELETE", new { Id = id }, cancellationToken);
}
