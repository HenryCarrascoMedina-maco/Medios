using Microsoft.Data.SqlClient;

namespace YoutubeMeta.Api.Infrastructure.Data;

/// <summary>Ejecuta procedimientos almacenados con Dapper; una conexión por llamada (pool de ADO.NET).</summary>
public sealed class DbExecuter(IConfiguration configuration)
{
    // Las columnas son DATETIME2: sin esto Dapper envía DateTime como DATETIME (pierde precisión).
    static DbExecuter() => SqlMapper.AddTypeMap(typeof(DateTime), DbType.DateTime2);

    private readonly string _connectionString = configuration.GetConnectionString("Default")
        ?? throw new InvalidOperationException("Falta ConnectionStrings:Default.");

    public async Task<IReadOnlyList<T>> Query<T>(string procedure, object? parameters, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return (await connection.QueryAsync<T>(Command(procedure, parameters, cancellationToken))).AsList();
    }

    public async Task<T?> Single<T>(string procedure, object? parameters, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QueryFirstOrDefaultAsync<T>(Command(procedure, parameters, cancellationToken));
    }

    public Task<(IReadOnlyList<T1>, IReadOnlyList<T2>)> Multiple<T1, T2>(string procedure, object? parameters, CancellationToken cancellationToken) =>
        Read<(IReadOnlyList<T1>, IReadOnlyList<T2>)>(procedure, parameters, async grid =>
            ((await grid.ReadAsync<T1>()).AsList(), (await grid.ReadAsync<T2>()).AsList()), cancellationToken);

    /// <summary>Procedimiento con varios resultados: <paramref name="read"/> los lee en orden.</summary>
    public async Task<T> Read<T>(string procedure, object? parameters, Func<SqlMapper.GridReader, Task<T>> read, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var grid = await connection.QueryMultipleAsync(Command(procedure, parameters, cancellationToken));
        return await read(grid);
    }

    public async Task Execute(string procedure, object? parameters, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(Command(procedure, parameters, cancellationToken));
    }

    public async Task Ping(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteScalarAsync<int>(new CommandDefinition("SELECT 1", cancellationToken: cancellationToken));
    }

    private async Task<SqlConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }

    private static CommandDefinition Command(string procedure, object? parameters, CancellationToken cancellationToken) =>
        new(procedure, parameters, commandType: CommandType.StoredProcedure, cancellationToken: cancellationToken);
}
