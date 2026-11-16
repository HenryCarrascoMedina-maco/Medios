using YoutubeMeta.Api.Common.Security;

namespace YoutubeMeta.Api.Application.Services;

/// <summary>
/// Un único administrador (usuario y hash en configuración). El token es JWT. Pensado para pasar a varios usuarios
/// más adelante: todo lo que identifica al usuario sale de los claims (id y nombre), no de la configuración.
/// </summary>
public sealed class AuthService(IOptions<AuthSettings> settings, JwtTokenService jwt, LoginThrottle throttle)
{
    public const int AdminUserId = 1;

    private readonly AuthSettings _settings = settings.Value;

    public async Task<CustomTransactionResponse<LoginResponse>> Login(LoginRequest request, string clientIp)
    {
        if (throttle.RetryAfter(clientIp) is { } wait)
            return CustomTransactionResponse<LoginResponse>.Fail(
                $"Demasiados intentos fallidos. Espera {Math.Ceiling(wait.TotalMinutes)} min y vuelve a probar.");

        bool valid = string.Equals(request.UserName?.Trim(), _settings.AdminUser, StringComparison.OrdinalIgnoreCase)
            && PasswordHasher.Verify(request.Password ?? string.Empty, _settings.AdminPasswordHash);

        if (!valid)
        {
            throttle.Failure(clientIp);
            await Task.Delay(400);
            return CustomTransactionResponse<LoginResponse>.Fail("Usuario o contraseña incorrectos.");
        }

        throttle.Success(clientIp);
        return CustomTransactionResponse<LoginResponse>.Ok(Issue(AdminUserId, _settings.AdminUser));
    }

    /// <summary>Token nuevo para una sesión aún válida (la app lo pide antes de que caduque el actual).</summary>
    public CustomTransactionResponse<LoginResponse> Refresh(int userId, string userName) =>
        userId == AdminUserId && string.Equals(userName, _settings.AdminUser, StringComparison.OrdinalIgnoreCase)
            ? CustomTransactionResponse<LoginResponse>.Ok(Issue(userId, _settings.AdminUser))
            : CustomTransactionResponse<LoginResponse>.Fail("La sesión ya no es válida. Vuelve a iniciar sesión.");

    private LoginResponse Issue(int userId, string userName)
    {
        var (token, expiresAt) = jwt.Create(userId, userName);
        return new LoginResponse { Token = token, UserName = userName, DisplayName = _settings.AdminDisplayName, ExpiresAt = expiresAt };
    }
}
