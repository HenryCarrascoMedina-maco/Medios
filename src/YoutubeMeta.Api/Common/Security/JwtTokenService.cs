using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace YoutubeMeta.Api.Common.Security;

public sealed class JwtTokenService(IOptions<AuthSettings> settings)
{
    private readonly AuthSettings _settings = settings.Value;

    public static SymmetricSecurityKey SigningKey(string key) => new(Encoding.UTF8.GetBytes(key));

    public (string Token, DateTime ExpiresAt) Create(int userId, string userName)
    {
        DateTime expiresAt = TimeClock.UtcNow.AddHours(_settings.TokenHours);
        var token = new JwtSecurityToken(
            issuer: _settings.JwtIssuer,
            audience: _settings.JwtIssuer,
            claims: [new Claim(AppClaims.Id, userId.ToString()), new Claim(AppClaims.Name, userName)],
            expires: expiresAt,
            signingCredentials: new SigningCredentials(SigningKey(_settings.JwtKey), SecurityAlgorithms.HmacSha256));

        return (new JwtSecurityTokenHandler().WriteToken(token), expiresAt);
    }
}
