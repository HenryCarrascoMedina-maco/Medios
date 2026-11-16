using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Application.Services;

/// <summary>Plantillas propias (publicación y respuestas de la bandeja), bloques de hashtags y firmas por cuenta.</summary>
public sealed class ContentService(ContentRepository content, ConnectionRepository connections, ExceptionHelper exception)
{
    /// <summary>Plantillas con sus adjuntos; <paramref name="usage"/> null = todas.</summary>
    public Task<CustomTransactionResponse<IReadOnlyList<TemplateItem>>> Templates(string? usage, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<IReadOnlyList<TemplateItem>>>(async () =>
            usage is null || TemplateUsages.IsValid(usage)
                ? CustomTransactionResponse<IReadOnlyList<TemplateItem>>.Ok(await content.Templates(usage, cancellationToken))
                : CustomTransactionResponse<IReadOnlyList<TemplateItem>>.Fail("Uso de plantilla no válido."));

    public Task<CustomTransactionResponse<int>> SaveTemplate(int? id, TemplateSaveRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<int>>(async () =>
            TemplateRules.Validate(request) is { } error
                ? CustomTransactionResponse<int>.Fail(error)
                : CustomTransactionResponse<int>.Ok(await content.TemplateSave(id, request, userName, cancellationToken)));

    public Task<CustomTransactionResponse<bool>> DeleteTemplate(int id, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<bool>>(async () =>
            await content.TemplateDelete(id, cancellationToken) > 0
                ? CustomTransactionResponse<bool>.Ok(true)
                : CustomTransactionResponse<bool>.Fail("La plantilla no existe."));

    /// <summary>Se usó la plantilla al publicar o responder (orden de «más usadas»).</summary>
    public Task<CustomTransactionResponse<bool>> TemplateUsed(int id, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<bool>>(async () =>
            await content.TemplateUsed(id, cancellationToken) > 0
                ? CustomTransactionResponse<bool>.Ok(true)
                : CustomTransactionResponse<bool>.Fail("La plantilla no existe."));

    public Task<CustomTransactionResponse<IReadOnlyList<HashtagBlockItem>>> HashtagBlocks(CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<IReadOnlyList<HashtagBlockItem>>>(async () =>
            CustomTransactionResponse<IReadOnlyList<HashtagBlockItem>>.Ok(await content.HashtagBlocks(cancellationToken)));

    public Task<CustomTransactionResponse<int>> SaveHashtagBlock(int? id, HashtagBlockSaveRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<int>>(async () =>
        {
            string name = request.Name?.Trim().ToLowerInvariant() ?? string.Empty;
            if (!ContentRules.IsValidBlockName(name))
                return CustomTransactionResponse<int>.Fail("El nombre solo admite minúsculas, números, - y _ (se usa como #bloque:nombre).");
            string text = request.Content?.Trim() ?? string.Empty;
            if (text.Length is 0 or > ContentRules.BlockContentMax)
                return CustomTransactionResponse<int>.Fail($"Los hashtags deben tener entre 1 y {ContentRules.BlockContentMax} caracteres.");

            return CustomTransactionResponse<int>.Ok(await content.HashtagBlockSave(id, name, text, userName, cancellationToken));
        });

    public Task<CustomTransactionResponse<bool>> DeleteHashtagBlock(int id, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<bool>>(async () =>
            await content.HashtagBlockDelete(id, cancellationToken) > 0
                ? CustomTransactionResponse<bool>.Ok(true)
                : CustomTransactionResponse<bool>.Fail("El bloque no existe."));

    public Task<CustomTransactionResponse<bool>> SaveSignature(int connectionId, SignatureRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<bool>>(async () =>
        {
            if ((request.Signature?.Length ?? 0) > ContentRules.SignatureMax)
                return CustomTransactionResponse<bool>.Fail($"La firma admite como máximo {ContentRules.SignatureMax} caracteres.");
            await connections.SignatureSave(connectionId, request.Signature, cancellationToken);
            return CustomTransactionResponse<bool>.Ok(true);
        });
}
