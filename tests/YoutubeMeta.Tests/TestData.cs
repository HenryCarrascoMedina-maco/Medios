using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using YoutubeMeta.Api.Domain.Constants;
using YoutubeMeta.Api.Domain.Requests;
using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.Data;

namespace YoutubeMeta.Tests;

/// <summary>Objetos de prueba que comparten varias clases.</summary>
internal static class TestData
{
    public static MediaInfo Image(int id = 1, string type = "image/jpeg", long size = 1024) => new(id, $"img{id}", MediaKinds.Image, type, size, null);

    public static MediaInfo Video(int id = 1) => new(id, "video", MediaKinds.Video, "video/mp4", 10_000, 30);

    public static MediaInfo Pdf(int id = 1, long size = 1024) => new(id, "doc", MediaKinds.Document, "application/pdf", size, null);

    public static PublicationDestination Destination(int connectionId = 1, string? description = "Hola", string? privacy = PrivacyStatus.Public,
        string? firstComment = null) => new()
    {
        ConnectionId = connectionId,
        Title = "Título",
        Description = description,
        PrivacyStatus = privacy,
        Options = new PublicationOptions { FirstComment = firstComment }
    };

    public static MemoryCache Cache() => new(new MemoryCacheOptions());

    public static DbExecuter Db(string connectionString) => new(new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:Default"] = connectionString })
        .Build());
}
