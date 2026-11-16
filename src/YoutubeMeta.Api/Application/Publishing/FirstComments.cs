namespace YoutubeMeta.Api.Application.Publishing;

/// <summary>
/// Plataformas que pueden poner un comentario de la propia cuenta justo después de publicar (Facebook, Instagram,
/// LinkedIn). Lo usa el job tras publicar y el botón «Reintentar comentario».
/// </summary>
public interface IFirstCommentPublisher
{
    Task<CommentResult> CommentAsync(CommentRequest request, CancellationToken cancellationToken);
}

/// <param name="PostExternalId">Id del post en la plataforma (ExternalId de la publicación).</param>
public sealed record CommentRequest(string Target, string ConnectionKey, string AccountExternalId, int? CredentialId, string PostExternalId, string Text);

/// <summary>CommentId = puesto; si no, Error dice por qué (texto para el usuario).</summary>
public sealed record CommentResult(string? CommentId, string? Error)
{
    public static CommentResult Ok(string id) => new(id, null);
    public static CommentResult Fail(string error) => new(null, error);
}

/// <summary>
/// El primer comentario nunca hace fallar ni repetir la publicación: si no se puede poner, el post queda publicado
/// con un aviso y el botón «Reintentar comentario».
/// </summary>
public static class FirstComments
{
    public static async Task<CommentResult> TryAsync(IPlatformPublisher publisher, CommentRequest request, ILogger logger, CancellationToken cancellationToken)
    {
        string label = Platforms.Label(request.Target);
        if (publisher is not IFirstCommentPublisher commenter) return CommentResult.Fail($"{label} no permite poner comentarios por API.");
        try
        {
            return await commenter.CommentAsync(request, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "No se pudo poner el primer comentario en {Target} ({Post}).", request.Target, request.PostExternalId);
            return CommentResult.Fail($"{label} no respondió a tiempo.");
        }
    }

    public static string Warning(string target, string error) =>
        $"Publicado, pero no se pudo poner el primer comentario: {error} Pulsa «Reintentar comentario».";

    public static string Done(string target) => $"Primer comentario puesto en {Platforms.Label(target)}.";
}
