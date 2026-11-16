using Microsoft.Data.SqlClient;
using System.Text.RegularExpressions;
using YoutubeMeta.Api.Domain.Constants;
using YoutubeMeta.Api.Domain.Entities;
using YoutubeMeta.Api.Infrastructure.Data;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Tests.Database;

/// <summary>
/// Base desechable en LocalDB creada con los scripts reales (001 + 002): las pruebas ejercitan los mismos
/// procedimientos que producción. Si LocalDB no está, las pruebas de BD se omiten (no fallan).
/// </summary>
public sealed partial class DatabaseFixture : IDisposable
{
    public const string Server = @"(localdb)\MSSQLLocalDB";
    public const string Name = "YoutubeMeta_Tests";

    private const string Master = $"Server={Server};Database=master;Trusted_Connection=True;TrustServerCertificate=True";
    private const string DropDatabase =
        $"IF DB_ID(N'{Name}') IS NOT NULL BEGIN ALTER DATABASE [{Name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{Name}]; END";

    public static readonly Lazy<bool> Available = new(() =>
    {
        try
        {
            using var connection = new SqlConnection($"{Master};Connection Timeout=5");
            connection.Open();
            return true;
        }
        catch
        {
            return false;
        }
    });

    public string ConnectionString { get; } = $"Server={Server};Database={Name};Trusted_Connection=True;TrustServerCertificate=True;Connection Timeout=30";

    public DbExecuter Db { get; }

    public DatabaseFixture()
    {
        Db = TestData.Db(ConnectionString);
        if (!Available.Value) return;

        ExecuteBatches(Master, $"{DropDatabase}\nGO\nCREATE DATABASE [{Name}];");

        string root = FindDatabaseFolder();
        ExecuteBatches(ConnectionString, File.ReadAllText(Path.Combine(root, "001-esquema.sql")));
        ExecuteBatches(ConnectionString, File.ReadAllText(Path.Combine(root, "002-procedimientos.sql")));
    }

    public async Task<T> Scalar<T>(string sql, object? parameters = null)
    {
        await using var connection = new SqlConnection(ConnectionString);
        return await Dapper.SqlMapper.ExecuteScalarAsync<T>(connection, sql, parameters) ?? throw new InvalidOperationException("Sin resultado.");
    }

    public async Task Execute(string sql, object? parameters = null)
    {
        await using var connection = new SqlConnection(ConnectionString);
        await Dapper.SqlMapper.ExecuteAsync(connection, sql, parameters);
    }

    public Task<int> MediaAsync(string kind = MediaKinds.Video, string contentType = "video/mp4", string extension = "mp4", string title = "Archivo") =>
        Scalar<int>("""
            INSERT INTO dbo.Media_Assets (Title, OriginalFileName, StoragePath, ContentType, SizeBytes, MediaKind, StatusCode, CreatedBy, CreatedAt)
            VALUES (@Title, CONCAT(N'a.', @Ext), CONCAT(N'videos/', NEWID(), N'.', @Ext), @Type, 1000, @Kind, 'READY', N'test', SYSUTCDATETIME());
            SELECT CAST(SCOPE_IDENTITY() AS INT);
            """, new { Title = title, Kind = kind, Type = contentType, Ext = extension });

    public Task<int> AccountAsync(string platform) => Scalar<int>("""
        INSERT INTO dbo.Social_Connections (Platform, ConnectionKey, ExternalId, DisplayName, StatusCode, IsDefault, ConnectedBy, ConnectedAt)
        VALUES (@Platform, LEFT(CONCAT('T-', NEWID()), 50), CONCAT('acc-', NEWID()), N'Cuenta', 'CONNECTED', 0, N'test', SYSUTCDATETIME());
        SELECT CAST(SCOPE_IDENTITY() AS INT);
        """, new { Platform = platform });

    /// <summary>Post VIDEO con el medio y una publicación en el estado pedido, en una cuenta nueva. Devuelve el id de la publicación.</summary>
    public async Task<long> PublicationAsync(int videoId, string target, string status, string? externalId = null, string? errorCode = null,
        int attempts = 0, DateTimeOffset? publishAt = null, DateTime? completedAt = null)
    {
        int connectionId = await AccountAsync(target);
        return await Scalar<long>("""
            DECLARE @Now DATETIME2(3) = SYSUTCDATETIME();
            INSERT INTO dbo.Posts (Kind, Title, CreatedBy, CreatedAt) VALUES ('VIDEO', N'Post', N'test', @Now);
            DECLARE @PostId INT = SCOPE_IDENTITY();
            INSERT INTO dbo.Post_Media (PostId, Position, MediaId) VALUES (@PostId, 0, @VideoId);
            INSERT INTO dbo.Publications (PostId, VideoId, ConnectionId, Target, Title, PrivacyStatus, PublishAt, MadeForKids, ContainsSyntheticMedia,
                ConsentAt, StatusCode, ExternalId, ErrorCode, Attempts, NextAttemptAt, CompletedAt, RequestedBy, RequestedAt)
            VALUES (@PostId, @VideoId, @ConnectionId, @Target, N'Título', IIF(@PublishAt IS NULL, 'public', 'private'), @PublishAt, 0, 0, @Now, @Status,
                @ExternalId, @ErrorCode, @Attempts, DATEADD(MINUTE, -1, @Now), @CompletedAt, N'test', DATEADD(MINUTE, -5, COALESCE(@CompletedAt, @Now)));
            SELECT CAST(SCOPE_IDENTITY() AS BIGINT);
            """, new
        {
            VideoId = videoId, ConnectionId = connectionId, Target = target, Status = status, ExternalId = externalId, ErrorCode = errorCode,
            Attempts = attempts, PublishAt = publishAt, CompletedAt = completedAt
        });
    }

    /// <summary>Reserva filas de la plataforma hasta dar con la pedida (otras pruebas comparten la cola).</summary>
    public async Task<PublicationDueItem?> TakeAsync(string target, long id, string owner)
    {
        var publications = new PublicationRepository(Db);
        for (int i = 0; i < 50; i++)
        {
            var taken = await publications.DueList(target, 1, owner, 10, CancellationToken.None);
            if (taken.Count == 0) return null;
            if (taken[0].Id == id) return taken[0];
        }
        return null;
    }

    private static void ExecuteBatches(string connectionString, string script)
    {
        using var connection = new SqlConnection(connectionString);
        connection.Open();
        foreach (string batch in GoSeparator().Split(script).Where(b => !string.IsNullOrWhiteSpace(b)))
        {
            using var command = new SqlCommand(batch, connection) { CommandTimeout = 120 };
            command.ExecuteNonQuery();
        }
    }

    private static string FindDatabaseFolder()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory != null && !File.Exists(Path.Combine(directory.FullName, "database", "001-esquema.sql")))
            directory = directory.Parent;
        return Path.Combine(directory?.FullName ?? throw new DirectoryNotFoundException("No se encontró la carpeta database."), "database");
    }

    public void Dispose()
    {
        if (!Available.Value) return;
        SqlConnection.ClearAllPools();
        try
        {
            ExecuteBatches(Master, DropDatabase);
        }
        catch
        {
            // Se borra en la siguiente ejecución.
        }
    }

    [GeneratedRegex(@"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex GoSeparator();
}

[CollectionDefinition(Name)]
public sealed class DatabaseCollection : ICollectionFixture<DatabaseFixture>
{
    public const string Name = "database";
}

/// <summary>Prueba que necesita LocalDB: se omite si no está instalado.</summary>
public sealed class DbFactAttribute : FactAttribute
{
    public DbFactAttribute()
    {
        if (!DatabaseFixture.Available.Value) Skip = "LocalDB no disponible.";
    }
}
