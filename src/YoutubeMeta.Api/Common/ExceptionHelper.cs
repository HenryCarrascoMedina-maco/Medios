using Microsoft.Data.SqlClient;
using System.Diagnostics;

namespace YoutubeMeta.Api.Common;

/// <summary>
/// Traduce excepciones a un mensaje para el usuario. Los SP lanzan 50001-50099 con un texto pensado para mostrarse
/// tal cual; cualquier otro error se registra completo y al usuario solo le llega un mensaje genérico con un código
/// para buscarlo en el registro (nunca detalles internos).
/// </summary>
public class ExceptionHelper(ILogger<ExceptionHelper> logger)
{
    public static bool IsUserMessage(SqlException ex) => ex.Number is >= 50001 and <= 50099;

    public async Task<T> TryCatchWrapperAsync<T>(Func<Task<T>> func)
        where T : CustomTransactionResponse, new()
    {
        try
        {
            return await func();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new() { IsSuccess = false, Errors = [UserMessage(ex)] };
        }
    }

    public async Task<IActionResult> TryCatchActionAsync(Func<Task<IActionResult>> action)
    {
        try
        {
            return await action();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new BadRequestObjectResult(UserMessage(ex));
        }
    }

    /// <summary>Mensaje seguro para el usuario; si no es un error previsto, se registra con su código.</summary>
    public string UserMessage(Exception ex)
    {
        if (ex is SqlException sql && IsUserMessage(sql)) return sql.Message;

        string code = CorrelationId();
        logger.LogError(ex, "Error no controlado [{Code}]: {Message}", code, ex.Message);
        return GenericMessage(code);
    }

    public static string GenericMessage(string code) =>
        $"Ocurrió un error al procesar la solicitud. Si se repite, comunica este código: {code}.";

    /// <summary>Id corto de la petición en curso (el mismo que queda en el registro).</summary>
    public static string CorrelationId() =>
        (Activity.Current?.TraceId.ToHexString() ?? Guid.NewGuid().ToString("N"))[..12];
}
