using Google.Apis.Json;
using Google.Apis.Util.Store;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Infrastructure.External.YouTube;

/// <summary>
/// IDataStore de la librería de Google sobre la fila de Connections (clave = ConnectionKey), con el
/// TokenResponse cifrado. Importante: ante CUALQUIER 4xx al refrescar (invalid_grant incluido) la
/// librería llama a DeleteAsync. Por eso aquí no se borra la fila: se marca NEEDS_RECONNECT, que es
/// lo que ve el usuario en Conexiones.
/// </summary>
public sealed class DbTokenDataStore(ConnectionRepository repository, SecretProtector protector) : IDataStore
{
    public async Task StoreAsync<T>(string key, T value)
    {
        string json = NewtonsoftJsonSerializer.Instance.Serialize(value);
        await repository.TokenSave(key, protector.Protect(json), CancellationToken.None);
    }

    public async Task<T> GetAsync<T>(string key)
    {
        string? cipher = await repository.TokenGet(key, CancellationToken.None);
        return cipher is null ? default! : NewtonsoftJsonSerializer.Instance.Deserialize<T>(protector.Unprotect(cipher));
    }

    public Task DeleteAsync<T>(string key) =>
        repository.MarkNeedsReconnect(key, "Google rechazó el acceso (revocado o caducado). Vuelve a conectar el canal.", CancellationToken.None);

    /// <summary>Nunca se borran todas las conexiones de golpe.</summary>
    public Task ClearAsync() => Task.CompletedTask;
}
