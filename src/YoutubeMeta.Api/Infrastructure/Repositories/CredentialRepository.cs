using YoutubeMeta.Api.Infrastructure.Data;

namespace YoutubeMeta.Api.Infrastructure.Repositories;

/// <summary>Claves de plataforma (Platform_Credentials): clientes OAuth, apps y bots de Telegram.</summary>
public sealed class CredentialRepository(DbExecuter db)
{
    public Task<IReadOnlyList<CredentialItem>> List(CancellationToken cancellationToken) =>
        db.Query<CredentialItem>("USP_CREDENTIAL_LIST", null, cancellationToken);

    public Task<CredentialRow?> Get(int id, CancellationToken cancellationToken) =>
        db.Single<CredentialRow>("USP_CREDENTIAL_GET", new { Id = id }, cancellationToken);

    /// <summary>La clave activa de una plataforma con una sola (Google, TikTok).</summary>
    public Task<CredentialRow?> GetForPlatform(string platform, CancellationToken cancellationToken) =>
        db.Single<CredentialRow>("USP_CREDENTIAL_GET", new { Platform = platform }, cancellationToken);

    public Task<int> Save(int? id, string platform, string name, string? publicId, string? secretCipher, string? settings, string userName, CancellationToken cancellationToken) =>
        db.Single<int>("USP_CREDENTIAL_SAVE", new
        {
            Id = id,
            Platform = platform,
            Name = name,
            PublicId = publicId,
            SecretCipher = secretCipher,
            Settings = settings,
            UserName = userName,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    public Task<string?> Delete(int id, string userName, CancellationToken cancellationToken) =>
        db.Single<string?>("USP_CREDENTIAL_DELETE", new { Id = id, UserName = userName, CurrentDate = TimeClock.UtcNow }, cancellationToken);
}
