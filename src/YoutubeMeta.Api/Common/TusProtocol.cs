namespace YoutubeMeta.Api.Common;

public interface ITusProtocol
{
    (bool IsValid, string? ErrorMessage) ValidateTusVersion();
    void AddTusHeaders();
    string BuildTusLocation(string uploadId);
}

public class TusProtocol(IHttpContextAccessor httpContextAccessor) : ITusProtocol
{
    private const string TusVersion = "1.0.0";
    private const string TusExtension = "creation,termination";

    private readonly IHttpContextAccessor _httpContextAccessor = httpContextAccessor;

    public (bool IsValid, string? ErrorMessage) ValidateTusVersion()
    {
        var context = _httpContextAccessor.HttpContext;
        if (context == null) return (false, "Contexto HTTP no disponible.");

        string requestTusVersion = context.Request.Headers["Tus-Resumable"].ToString();
        if (string.IsNullOrWhiteSpace(requestTusVersion))
        {
            AddTusHeaders();
            return (false, "El header Tus-Resumable es requerido.");
        }

        string[] requestVersions = requestTusVersion.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (!requestVersions.Contains(TusVersion, StringComparer.Ordinal))
        {
            AddTusHeaders();
            return (false, $"Versión TUS no soportada: {requestTusVersion}");
        }

        return (true, null);
    }

    public void AddTusHeaders()
    {
        var context = _httpContextAccessor.HttpContext;
        if (context == null) return;

        context.Response.Headers["Tus-Resumable"] = TusVersion;
        context.Response.Headers["Tus-Version"] = TusVersion;
        context.Response.Headers["Tus-Extension"] = TusExtension;
    }

    public string BuildTusLocation(string uploadId)
    {
        var request = _httpContextAccessor.HttpContext?.Request;
        return request == null ? string.Empty : $"{request.Scheme}://{request.Host}{request.PathBase}/api/Video/tus/{uploadId}";
    }
}
