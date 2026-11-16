using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.External.Meta;
using YoutubeMeta.Api.Infrastructure.External.WhatsApp;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;

#region RESPONSES
using OptionsResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.MetaAccountOption>>;
using SaveResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.AccountSaveResult>>;
#endregion

namespace YoutubeMeta.Api.Application.Services;

/// <summary>
/// Páginas de Facebook, cuentas de Instagram y números de WhatsApp Business con el token del usuario del sistema de
/// Meta Business. Paso 1: listar a qué da acceso el token. Paso 2: conectar las elegidas (varias a la vez).
/// Facebook guarda el token de cada Página (derivado, no caduca); Instagram y WhatsApp guardan el del usuario del sistema.
/// </summary>
public sealed class MetaAccountService(
        MetaGraphClient graph,
        WhatsAppClient whatsapp,
        ConnectionRepository connections,
        SecretProtector protector,
        IProgressNotifier notifier,
        ExceptionHelper exception)
{
    private const string FacebookPublishScope = "pages_manage_posts";
    private static readonly string[] InstagramScopes = ["instagram_basic", "instagram_content_publish"];

    #region FACEBOOK
    public Task<OptionsResponse> FacebookPages(MetaTokenRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<OptionsResponse>(async () =>
        {
            string token = request.SystemUserToken?.Trim() ?? string.Empty;
            if (token.Length == 0) return OptionsResponse.Fail("Pega el token del usuario del sistema.");

            var pages = await graph.PagesAsync(token, cancellationToken);
            if (!pages.Ok) return OptionsResponse.Fail(MetaErrorClassifier.Friendly(pages.Error!));
            if (pages.Data!.Count == 0) return OptionsResponse.Fail("El token no tiene ninguna Página asignada. Asigna las Páginas al usuario del sistema (paso 6 de la guía).");

            var connected = await ConnectedIdsAsync(Platforms.Facebook, cancellationToken);
            return OptionsResponse.Ok(pages.Data.Select(p => new MetaAccountOption
            {
                Id = p.Id,
                Name = p.Name,
                PictureUrl = p.PictureUrl,
                Detail = p.Category,
                CanPublish = p.CanCreateContent,
                Problem = p.CanCreateContent ? null : "El usuario del sistema no tiene la tarea «Contenido» en esta Página.",
                AlreadyConnected = connected.Contains(p.Id)
            }).ToList());
        });

    /// <summary>El token del usuario del sistema se usa solo en esta llamada para obtener el de cada Página; no se guarda.</summary>
    public Task<SaveResponse> FacebookSave(MetaAccountsSaveRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<SaveResponse>(async () =>
        {
            string userToken = request.SystemUserToken?.Trim() ?? string.Empty;
            if (userToken.Length == 0 || request.AccountIds.Count == 0) return SaveResponse.Fail("Falta el token o las Páginas.");

            var pages = await graph.PagesAsync(userToken, cancellationToken);
            if (!pages.Ok) return SaveResponse.Fail(MetaErrorClassifier.Friendly(pages.Error!));

            var results = new List<AccountSaveResult>();
            foreach (string pageId in request.AccountIds.Distinct())
            {
                var page = pages.Data!.FirstOrDefault(p => p.Id == pageId);
                var result = new AccountSaveResult { Name = page?.Name ?? pageId };
                results.Add(result);

                if (page?.AccessToken is not { Length: > 0 } pageToken) { result.Error = "El token no da acceso a esta Página."; continue; }
                if (!page.CanCreateContent) { result.Error = "Falta la tarea «Contenido» para el usuario del sistema."; continue; }

                var info = await graph.DebugTokenAsync(pageToken, userToken, cancellationToken);
                if (info.Ok && info.Data!.Scopes.Length > 0 && !info.Data.Scopes.Contains(FacebookPublishScope))
                {
                    result.Error = $"Al token le falta el permiso {FacebookPublishScope}. Genéralo de nuevo con los permisos del paso 7.";
                    continue;
                }

                var check = await graph.PageAsync(page.Id, pageToken, cancellationToken);
                if (!check.Ok) { result.Error = MetaErrorClassifier.Friendly(check.Error!); continue; }

                var saved = await connections.Save(new ConnectionSave(
                    Platforms.Facebook,
                    $"FB-{Guid.NewGuid():N}",
                    page.Id,
                    page.Name,
                    page.PictureUrl,
                    page.Category,
                    info.Ok ? string.Join(' ', info.Data!.Scopes) : null,
                    info.Ok ? info.Data!.ExpiresAt : null,
                    protector.Protect(pageToken),
                    userName), cancellationToken);
                result.ConnectionId = saved?.Id;
                result.IsNew = saved?.IsNew ?? false;
            }

            await notifier.ConnectionChangedAsync(Platforms.Facebook, cancellationToken);
            return Respond(results);
        });
    #endregion

    #region INSTAGRAM
    /// <summary>Cuentas profesionales de Instagram vinculadas a las Páginas que tiene asignadas el usuario del sistema.</summary>
    public Task<OptionsResponse> InstagramAccounts(MetaTokenRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<OptionsResponse>(async () =>
        {
            string token = request.SystemUserToken?.Trim() ?? string.Empty;
            if (token.Length == 0) return OptionsResponse.Fail("Pega el token del usuario del sistema.");

            var pages = await graph.PagesAsync(token, cancellationToken);
            if (!pages.Ok) return OptionsResponse.Fail(MetaErrorClassifier.Friendly(pages.Error!));

            var linked = pages.Data!.Where(p => p.Instagram != null).ToList();
            if (linked.Count == 0)
                return OptionsResponse.Fail("Ninguna Página asignada al usuario del sistema tiene una cuenta profesional de Instagram vinculada. Revisa los pasos 1 y 2 de la guía de Instagram.");

            string? scopeProblem = await MissingInstagramScopesAsync(token, cancellationToken);
            var connected = await ConnectedIdsAsync(Platforms.Instagram, cancellationToken);

            return OptionsResponse.Ok(linked.Select(p => new MetaAccountOption
            {
                Id = p.Instagram!.Id,
                Name = p.Instagram.Name ?? p.Instagram.Username,
                Username = p.Instagram.Username,
                PictureUrl = p.Instagram.PictureUrl,
                Detail = $"Página: {p.Name}",
                CanPublish = scopeProblem == null && p.CanCreateContent,
                Problem = scopeProblem ?? (p.CanCreateContent ? null : "El usuario del sistema no tiene la tarea «Contenido» en la Página vinculada."),
                AlreadyConnected = connected.Contains(p.Instagram.Id)
            }).ToList());
        });

    public Task<SaveResponse> InstagramSave(MetaAccountsSaveRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<SaveResponse>(async () =>
        {
            string token = request.SystemUserToken?.Trim() ?? string.Empty;
            if (token.Length == 0 || request.AccountIds.Count == 0) return SaveResponse.Fail("Falta el token o las cuentas.");

            if (await MissingInstagramScopesAsync(token, cancellationToken) is { } scopeProblem) return SaveResponse.Fail(scopeProblem);

            var pages = await graph.PagesAsync(token, cancellationToken);
            if (!pages.Ok) return SaveResponse.Fail(MetaErrorClassifier.Friendly(pages.Error!));
            var info = await graph.DebugTokenAsync(token, token, cancellationToken);

            var results = new List<AccountSaveResult>();
            foreach (string igId in request.AccountIds.Distinct())
            {
                var page = pages.Data!.FirstOrDefault(p => p.Instagram?.Id == igId);
                var result = new AccountSaveResult { Name = page?.Instagram?.Username is { } u ? $"@{u}" : igId };
                results.Add(result);

                if (page?.Instagram is not { } ig) { result.Error = "El token no da acceso a esta cuenta de Instagram."; continue; }

                var check = await graph.InstagramAccountAsync(ig.Id, token, cancellationToken);
                if (!check.Ok) { result.Error = MetaErrorClassifier.Friendly(check.Error!); continue; }

                var saved = await connections.Save(new ConnectionSave(
                    Platforms.Instagram,
                    $"IG-{Guid.NewGuid():N}",
                    ig.Id,
                    ig.Name ?? ig.Username,
                    ig.PictureUrl,
                    $"@{ig.Username} · {page.Name}",
                    info.Ok ? string.Join(' ', info.Data!.Scopes) : null,
                    info.Ok ? info.Data!.ExpiresAt : null,
                    protector.Protect(token),
                    userName), cancellationToken);
                result.ConnectionId = saved?.Id;
                result.IsNew = saved?.IsNew ?? false;
            }

            await notifier.ConnectionChangedAsync(Platforms.Instagram, cancellationToken);
            return Respond(results);
        });

    private async Task<string?> MissingInstagramScopesAsync(string token, CancellationToken cancellationToken)
    {
        var info = await graph.DebugTokenAsync(token, token, cancellationToken);
        if (!info.Ok || info.Data!.Scopes.Length == 0) return null;
        string[] missing = InstagramScopes.Where(s => !info.Data.Scopes.Contains(s)).ToArray();
        return missing.Length == 0 ? null : $"Al token le faltan los permisos {string.Join(", ", missing)}. Genéralo de nuevo marcándolos (paso 5 de la guía de Instagram).";
    }
    #endregion

    #region WHATSAPP (solo bandeja)
    private const string WhatsAppManagementScope = "whatsapp_business_management";
    private const string WhatsAppMessagingScope = "whatsapp_business_messaging";

    /// <summary>Números de las cuentas de WhatsApp Business a las que da acceso el token (salen de granular_scopes).</summary>
    public Task<OptionsResponse> WhatsAppNumbers(MetaTokenRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<OptionsResponse>(async () =>
        {
            string token = request.SystemUserToken?.Trim() ?? string.Empty;
            if (token.Length == 0) return OptionsResponse.Fail("Pega el token del usuario del sistema.");

            var (numbers, problem) = await WhatsAppNumbersAsync(token, cancellationToken);
            if (problem is not null) return OptionsResponse.Fail(problem);

            var connected = await ConnectedIdsAsync(Platforms.WhatsApp, cancellationToken);
            return OptionsResponse.Ok(numbers.Select(n => new MetaAccountOption
            {
                Id = n.Id,
                Name = n.VerifiedName.Length > 0 ? n.VerifiedName : n.DisplayPhoneNumber,
                Detail = n.DisplayPhoneNumber,
                CanPublish = true,
                AlreadyConnected = connected.Contains(n.Id)
            }).ToList());
        });

    /// <summary>Conecta los números elegidos y suscribe la app a su cuenta de WhatsApp Business (para recibir los mensajes).</summary>
    public Task<SaveResponse> WhatsAppSave(MetaAccountsSaveRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<SaveResponse>(async () =>
        {
            string token = request.SystemUserToken?.Trim() ?? string.Empty;
            if (token.Length == 0 || request.AccountIds.Count == 0) return SaveResponse.Fail("Falta el token o los números.");

            var (numbers, problem) = await WhatsAppNumbersAsync(token, cancellationToken);
            if (problem is not null) return SaveResponse.Fail(problem);
            var info = await graph.DebugTokenAsync(token, token, cancellationToken);

            var results = new List<AccountSaveResult>();
            foreach (string id in request.AccountIds.Distinct())
            {
                var number = numbers.FirstOrDefault(n => n.Id == id);
                var result = new AccountSaveResult { Name = number?.DisplayPhoneNumber ?? id };
                results.Add(result);
                if (number is null) { result.Error = "El token no da acceso a este número."; continue; }

                var saved = await connections.Save(new ConnectionSave(
                    Platforms.WhatsApp,
                    $"WA-{Guid.NewGuid():N}",
                    number.Id,
                    number.VerifiedName.Length > 0 ? number.VerifiedName : number.DisplayPhoneNumber,
                    null,
                    number.DisplayPhoneNumber,
                    info.Ok ? string.Join(' ', info.Data!.Scopes) : null,
                    info.Ok ? info.Data!.ExpiresAt : null,
                    protector.Protect(token),
                    userName,
                    Extra: new ConnectionExtra { WabaId = number.WabaId }.ToJson()), cancellationToken);
                result.ConnectionId = saved?.Id;
                result.IsNew = saved?.IsNew ?? false;

                // Sin suscripción no llegan los mensajes; si falla aquí, la bandeja lo reintenta y lo explica en Configuración.
                await graph.SubscribeAppAsync(number.WabaId, token, null, cancellationToken);
            }

            await notifier.ConnectionChangedAsync(Platforms.WhatsApp, cancellationToken);
            return Respond(results);
        });

    private async Task<(IReadOnlyList<WhatsAppNumber> Numbers, string? Problem)> WhatsAppNumbersAsync(string token, CancellationToken cancellationToken)
    {
        var info = await graph.DebugTokenAsync(token, token, cancellationToken);
        if (!info.Ok) return ([], MetaErrorClassifier.Friendly(info.Error!));
        if (info.Data!.Scopes.Length > 0 && !info.Data.Scopes.Contains(WhatsAppMessagingScope))
            return ([], $"Al token le falta el permiso {WhatsAppMessagingScope}. Genéralo de nuevo marcándolo (guía de WhatsApp).");

        string[] wabas = info.Data.TargetIds.GetValueOrDefault(WhatsAppManagementScope) ?? info.Data.TargetIds.GetValueOrDefault(WhatsAppMessagingScope) ?? [];
        if (wabas.Length == 0)
            return ([], "El token no da acceso a ninguna cuenta de WhatsApp Business. Asigna la cuenta al usuario del sistema (guía de WhatsApp, paso 4).");

        var numbers = new List<WhatsAppNumber>();
        foreach (string waba in wabas.Distinct())
        {
            var list = await whatsapp.NumbersAsync(waba, token, cancellationToken);
            if (!list.Ok) return ([], MetaErrorClassifier.Friendly(list.Error!));
            numbers.AddRange(list.Data!);
        }
        return numbers.Count == 0 ? ([], "La cuenta de WhatsApp Business no tiene ningún número registrado.") : (numbers, null);
    }
    #endregion

    private async Task<HashSet<string>> ConnectedIdsAsync(string platform, CancellationToken cancellationToken) =>
        (await connections.List(cancellationToken))
            .Where(c => c.Platform == platform && c.StatusCode != ConnectionStatus.Revoked)
            .Select(c => c.ExternalId)
            .ToHashSet();

    private static SaveResponse Respond(List<AccountSaveResult> results) =>
        results.Any(r => r.Error == null)
            ? SaveResponse.Ok(results)
            : SaveResponse.Fail(string.Join(" ", results.Select(r => $"{r.Name}: {r.Error}")));

}
