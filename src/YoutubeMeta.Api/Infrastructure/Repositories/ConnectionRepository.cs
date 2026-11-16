using YoutubeMeta.Api.Infrastructure.Data;

namespace YoutubeMeta.Api.Infrastructure.Repositories;

public sealed class ConnectionRepository(DbExecuter db)
{
    public Task SignatureSave(int id, string? signature, CancellationToken cancellationToken) =>
        db.Execute("USP_CONNECTION_SIGNATURE_SAVE", new { Id = id, Signature = signature }, cancellationToken);

    public Task<IReadOnlyList<ConnectionItem>> List(CancellationToken cancellationToken) =>
        db.Query<ConnectionItem>("USP_CONNECTION_LIST", null, cancellationToken);

    public Task<ConnectionRow?> Get(int id, CancellationToken cancellationToken) =>
        db.Single<ConnectionRow>("USP_CONNECTION_GET", new { Id = id }, cancellationToken);

    public Task<ConnectionRow?> GetDefault(string platform, CancellationToken cancellationToken) =>
        db.Single<ConnectionRow>("USP_CONNECTION_GET", new { Platform = platform }, cancellationToken);

    public Task<IReadOnlyList<ConnectionRow>> ActiveList(CancellationToken cancellationToken) =>
        db.Query<ConnectionRow>("USP_CONNECTION_ACTIVE_LIST", null, cancellationToken);

    /// <summary>Añade la cuenta o, si ya estaba conectada, la reconecta (misma fila).</summary>
    public Task<ConnectionSaved?> Save(ConnectionSave connection, CancellationToken cancellationToken) =>
        db.Single<ConnectionSaved>("USP_CONNECTION_SAVE", new
        {
            connection.Platform,
            connection.ConnectionKey,
            connection.ExternalId,
            connection.DisplayName,
            connection.AvatarUrl,
            connection.AccountHint,
            connection.Scopes,
            connection.TokenExpiresAt,
            connection.SecretCipher,
            connection.CredentialId,
            connection.Extra,
            connection.UserName,
            CurrentDate = TimeClock.UtcNow
        }, cancellationToken);

    public Task<string?> DefaultSet(int id, CancellationToken cancellationToken) =>
        db.Single<string?>("USP_CONNECTION_DEFAULT_SET", new { Id = id }, cancellationToken);

    public Task<string?> AliasSave(int id, string? alias, CancellationToken cancellationToken) =>
        db.Single<string?>("USP_CONNECTION_ALIAS_SAVE", new { Id = id, Alias = alias }, cancellationToken);

    public Task<ConnectionDeleted?> Delete(int id, string userName, CancellationToken cancellationToken) =>
        db.Single<ConnectionDeleted>("USP_CONNECTION_DELETE", new { Id = id, UserName = userName, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task TestSave(int id, bool isOk, string message, CancellationToken cancellationToken) =>
        db.Execute("USP_CONNECTION_TEST_SAVE", new { Id = id, IsOk = isOk, Message = message, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    #region TOKEN (DbTokenDataStore y tokens que se renuevan, como TikTok)
    public Task<string?> TokenGet(string connectionKey, CancellationToken cancellationToken) =>
        db.Single<string?>("USP_CONNECTION_TOKEN_GET", new { ConnectionKey = connectionKey }, cancellationToken);

    public Task TokenSave(string connectionKey, string secretCipher, CancellationToken cancellationToken) =>
        db.Execute("USP_CONNECTION_TOKEN_SAVE", new { ConnectionKey = connectionKey, SecretCipher = secretCipher, CurrentDate = TimeClock.UtcNow }, cancellationToken);

    public Task MarkNeedsReconnect(string connectionKey, string message, CancellationToken cancellationToken) =>
        db.Execute("USP_CONNECTION_MARK_RECONNECT", new { ConnectionKey = connectionKey, Message = message, CurrentDate = TimeClock.UtcNow }, cancellationToken);
    #endregion
}

public sealed record ConnectionSave(
    string Platform,
    string ConnectionKey,
    string ExternalId,
    string DisplayName,
    string? AvatarUrl,
    string? AccountHint,
    string? Scopes,
    DateTime? TokenExpiresAt,
    string? SecretCipher,
    string UserName,
    int? CredentialId = null,
    string? Extra = null);
