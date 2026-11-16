using System.Security.Cryptography;
using System.Text;

namespace YoutubeMeta.Api.Common.Security;

/// <summary>Compara firmas en tiempo constante: el tiempo de respuesta no revela cuántos caracteres coinciden.</summary>
public static class FixedTimeText
{
    public static bool Matches(string expected, string actual)
    {
        byte[] left = Encoding.ASCII.GetBytes(expected);
        byte[] right = Encoding.ASCII.GetBytes(actual);
        return left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);
    }
}
