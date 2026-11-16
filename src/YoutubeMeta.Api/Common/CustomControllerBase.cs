namespace YoutubeMeta.Api.Common;

[ApiController]
public abstract class CustomControllerBase : ControllerBase
{
    protected int GetUserId => int.TryParse(User.FindFirst(AppClaims.Id)?.Value, out int id) ? id : 0;

    protected string GetUserName => User.FindFirst(AppClaims.Name)?.Value ?? string.Empty;

    protected IActionResult Reply<T>(CustomTransactionResponse<T> result, string message)
    {
        if (!result.IsSuccess) return BadRequest(result.Errors.FirstOrDefault() ?? "No se pudo completar la operación.");
        if (result.Data is null) return NotFound(ResponseMessage.NotFound);

        return Ok(new CustomGenericResponse<T> { IsSuccess = true, Data = result.Data, Message = message });
    }
}
