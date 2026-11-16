namespace YoutubeMeta.Api.Common;

public class CustomGenericResponse<T>
{
    public bool IsSuccess { get; set; }
    public string? Message { get; set; }
    public T? Data { get; set; }
}

public class CustomTransactionResponse
{
    public string[] Errors { get; set; } = [];
    public bool IsSuccess { get; set; }
}

public class CustomTransactionResponse<T> : CustomTransactionResponse
{
    public T? Data { get; set; }

    public static CustomTransactionResponse<T> Ok(T data) => new() { IsSuccess = true, Data = data };
    public static CustomTransactionResponse<T> Fail(string error) => new() { IsSuccess = false, Errors = [error] };
}

public static class ResponseMessage
{
    public const string Found = "Registro encontrado.";
    public const string Listed = "Listado obtenido.";
    public const string Created = "Registro creado.";
    public const string Updated = "Registro actualizado.";
    public const string Deleted = "Registro eliminado.";
    public const string NotFound = "No existe el recurso.";
}
