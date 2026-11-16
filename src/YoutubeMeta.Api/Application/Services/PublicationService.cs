using Microsoft.Data.SqlClient;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.RealTime;
using YoutubeMeta.Api.Infrastructure.Repositories;

#region RESPONSES
using CreateResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.PublicationCreateResult>>;
using ListResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.PublicationItem>>;
using EventsResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.PublicationEventItem>>;
using ActionResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<YoutubeMeta.Api.Domain.Entities.PublicationResultRow>;
using NotificationsResponse = YoutubeMeta.Api.Common.CustomTransactionResponse<System.Collections.Generic.IReadOnlyList<YoutubeMeta.Api.Domain.Responses.NotificationItem>>;
#endregion

namespace YoutubeMeta.Api.Application.Services;

public sealed class PublicationService(
        PublicationRepository publications,
        VideoRepository videos,
        ConnectionRepository connections,
        ActivityRepository activity,
        IProgressNotifier notifier,
        MediaLinks links,
        IEnumerable<IPlatformPublisher> publishers,
        IOptions<PlatformsSettings> platforms,
        ExceptionHelper exception,
        ILogger<PublicationService> logger)
{
    private const int MaxDestinations = 20;

    /// <summary>
    /// Cada fila de la cola nace de un clic con consentimiento expreso (políticas III.C.2 / III.I.2 de YouTube).
    /// El tipo del post sale de sus archivos y su enlace. Primero se validan TODOS los destinos (texto, tipo admitido,
    /// límites de los archivos): si alguno no es válido no se encola ninguno. Después se crea el post y cada cuenta se
    /// encola por separado; el resultado dice cuáles entraron (otra pudo tener ya ese post en curso).
    /// </summary>
    public Task<CreateResponse> Create(PublicationCreateRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CreateResponse>(async () =>
        {
            if (!request.Consent) return CreateResponse.Fail("Falta confirmar el consentimiento de publicación.");

            var inputs = request.Media.Count > 0 ? request.Media
                : request.VideoId is > 0 ? [new PostMediaInput { Id = request.VideoId.Value }] : new List<PostMediaInput>();
            if (inputs.Select(m => m.Id).Distinct().Count() != inputs.Count) return CreateResponse.Fail("Un archivo está repetido en la publicación.");

            var destinations = request.Destinations.GroupBy(d => d.ConnectionId).Select(g => g.First()).ToList();
            if (destinations.Count == 0) return CreateResponse.Fail("Elige al menos una cuenta de destino.");
            if (destinations.Count > MaxDestinations) return CreateResponse.Fail($"Como mucho {MaxDestinations} cuentas por publicación.");

            var media = new List<MediaInfo>();
            foreach (var input in inputs)
            {
                var file = await videos.GetFile(input.Id, cancellationToken);
                if (file == null) return CreateResponse.Fail("Uno de los archivos no existe o fue eliminado. Recarga la biblioteca.");
                media.Add(new MediaInfo(file.Id, file.Title, file.MediaKind, file.ContentType, file.SizeBytes, file.DurationSec));
            }

            var (kind, kindError) = PostRules.InferKind(media, request.LinkUrl);
            if (kind is null) return CreateResponse.Fail(kindError!);

            // El título solo se pide en video y PDF; en el resto, si falta, sale del texto (la columna es obligatoria).
            foreach (var d in destinations.Where(d => string.IsNullOrWhiteSpace(d.Title) && kind is not (PostKinds.Video or PostKinds.Document)))
                d.Title = PostRules.TitleFromText(d.Description, kind);

            var accounts = (await connections.List(cancellationToken))
                .Where(c => c.StatusCode != ConnectionStatus.Revoked)
                .ToDictionary(c => c.Id);

            var now = DateTimeOffset.UtcNow;
            foreach (var destination in destinations)
            {
                if (!accounts.TryGetValue(destination.ConnectionId, out var account))
                    return CreateResponse.Fail("Una de las cuentas elegidas ya no está conectada. Recarga la página.");
                if (!Platforms.IsValid(account.Platform))
                    return CreateResponse.Fail($"{Platforms.Label(account.Platform)} no publica: esa cuenta solo sirve para la bandeja.");
                if (!platforms.Value.IsEnabled(account.Platform))
                    return CreateResponse.Fail($"{Platforms.Label(account.Platform)} está desactivado en esta instalación.");

                var capability = PlatformCapabilities.ForAccount(account.Platform, account.ExternalId);
                string? error = PlatformCapabilities.Validate(capability, kind, media, links.IsAvailable)
                    ?? PublicationRules.Validate(account.Platform, destination, now, kind, capability)
                    ?? (kind == PostKinds.Video ? PublicationRules.ValidateMedia(account.Platform, media[0].SizeBytes, media[0].DurationSec, account.UploadLimitMb) : null)
                    ?? (kind == PostKinds.Document && account.Platform == Platforms.Telegram
                        ? PublicationRules.ValidateMedia(account.Platform, media[0].SizeBytes, null, account.UploadLimitMb) : null);
                if (error != null) return CreateResponse.Fail($"{Platforms.Label(account.Platform)} · {AccountName(account)}: {error}");
            }

            string postTitle = TextHelper.FirstNonBlank(request.Title, destinations[0].Title, media.FirstOrDefault()?.Title) ?? PostKinds.Label(kind);
            int postId = await publications.PostCreate(kind, postTitle, request.LinkUrl, inputs, userName, cancellationToken);
            int? mainMediaId = media.Count > 0 ? media[0].Id : null;

            var results = new List<PublicationCreateResult>();
            foreach (var destination in destinations)
            {
                var account = accounts[destination.ConnectionId];
                var result = new PublicationCreateResult { ConnectionId = account.Id, AccountName = $"{Platforms.Label(account.Platform)} · {AccountName(account)}" };
                try
                {
                    result.PublicationId = await publications.Save(postId, mainMediaId, destination, userName, cancellationToken);
                    await Notify(result.PublicationId.Value, mainMediaId, account.Id, account.Platform, PublicationStatus.Pending, cancellationToken);
                }
                catch (SqlException ex) when (ExceptionHelper.IsUserMessage(ex))
                {
                    result.Error = ex.Message;
                }
                results.Add(result);
            }

            return results.Any(r => r.PublicationId != null)
                ? CreateResponse.Ok(results)
                : CreateResponse.Fail(string.Join(" ", results.Select(r => $"{r.AccountName}: {r.Error}")));
        });

    /// <summary>Vuelve a poner el primer comentario de una publicación ya publicada (cuando falló al publicar).</summary>
    public Task<ActionResponse> RetryComment(long id, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ActionResponse>(async () =>
        {
            var row = await publications.CommentGet(id, cancellationToken);
            if (row == null) return ActionResponse.Fail("La publicación no existe.");
            if (row.StatusCode != PublicationStatus.Done || string.IsNullOrEmpty(row.ExternalId))
                return ActionResponse.Fail("Solo se pone el comentario en una publicación ya publicada.");
            if (row.CommentExternalId != null) return ActionResponse.Fail("El primer comentario ya está puesto.");

            string? text = PublicationOptions.Parse(row.Extra).FirstComment;
            if (string.IsNullOrWhiteSpace(text)) return ActionResponse.Fail("Esta publicación no tiene primer comentario.");
            if (row.ConnectionStatus != ConnectionStatus.Connected)
                return ActionResponse.Fail($"La cuenta de {Platforms.Label(row.Target)} necesita reconectarse. Hazlo en Conexiones y vuelve a intentarlo.");

            var publisher = publishers.FirstOrDefault(p => p.Platform == row.Target);
            if (publisher == null) return ActionResponse.Fail("Plataforma no válida.");

            var request = new CommentRequest(row.Target, row.ConnectionKey, row.AccountExternalId, row.CredentialId, row.ExternalId, text.Trim());
            var result = await FirstComments.TryAsync(publisher, request, logger, cancellationToken);
            string message = result.CommentId != null ? FirstComments.Done(row.Target) : FirstComments.Warning(row.Target, result.Error ?? "error desconocido.");

            var saved = await publications.CommentSave(id, result.CommentId, message, cancellationToken);
            if (saved == null) return ActionResponse.Fail("La publicación no existe.");
            await Notify(id, saved.VideoId, row.ConnectionId, row.Target, saved.StatusCode, cancellationToken);
            return result.CommentId != null ? ActionResponse.Ok(saved) : ActionResponse.Fail(result.Error ?? "No se pudo poner el comentario.");
        });

    public Task<ListResponse> List(PublicationListQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ListResponse>(async () => ListResponse.Ok(await publications.List(query, cancellationToken)));

    public Task<EventsResponse> Events(int videoId, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<EventsResponse>(async () => EventsResponse.Ok(await publications.Events(videoId, cancellationToken)));

    public Task<ActionResponse> Retry(long id, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ActionResponse>(async () =>
        {
            var row = await publications.Retry(id, userName, cancellationToken);
            if (row == null) return ActionResponse.Fail("La publicación no existe.");
            await Notify(id, row.VideoId, null, row.Target, row.StatusCode, cancellationToken);
            return ActionResponse.Ok(row);
        });

    public Task<ActionResponse> Cancel(long id, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ActionResponse>(async () =>
        {
            var row = await publications.Cancel(id, userName, cancellationToken);
            if (row == null) return ActionResponse.Fail("La publicación no existe.");
            await Notify(id, row.VideoId, null, row.Target, row.StatusCode, cancellationToken);
            return ActionResponse.Ok(row);
        });

    /// <summary>
    /// Decide a mano una publicación en revisión (o fallida): «ya está publicado» (con su enlace si se conoce) o
    /// «publicar de nuevo» desde cero.
    /// </summary>
    public Task<ActionResponse> Resolve(long id, PublicationResolveRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ActionResponse>(async () =>
        {
            if (!PublicationResolution.IsValid(request.Action)) return ActionResponse.Fail("Acción no válida.");
            if (request.Action == PublicationResolution.MarkDone && !IsHttpUrl(request.ExternalUrl))
                return ActionResponse.Fail("El enlace debe empezar por http:// o https://.");

            var row = await publications.Resolve(id, request.Action, request.ExternalUrl, userName, cancellationToken);
            if (row == null) return ActionResponse.Fail("La publicación no existe.");
            await Notify(id, row.VideoId, null, row.Target, row.StatusCode, cancellationToken);
            return ActionResponse.Ok(row);
        });

    public const int CalendarMaxDays = 62;

    public Task<CustomTransactionResponse<IReadOnlyList<CalendarItem>>> Calendar(CalendarQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<IReadOnlyList<CalendarItem>>>(async () =>
        {
            if (query.To <= query.From) return CustomTransactionResponse<IReadOnlyList<CalendarItem>>.Fail("El rango de fechas no es válido.");
            if ((query.To - query.From).TotalDays > CalendarMaxDays)
                return CustomTransactionResponse<IReadOnlyList<CalendarItem>>.Fail($"Como mucho {CalendarMaxDays} días por consulta.");
            return CustomTransactionResponse<IReadOnlyList<CalendarItem>>.Ok(await publications.Calendar(query.From, query.To, cancellationToken));
        });

    /// <summary>Mueve una publicación que aún no está en la plataforma, con la ventana de programación de su plataforma.</summary>
    public Task<ActionResponse> Reschedule(long id, RescheduleRequest request, string userName, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<ActionResponse>(async () =>
        {
            string? target = await publications.TargetOf(id, cancellationToken);
            if (target is null) return ActionResponse.Fail("La publicación no existe. Recarga el calendario.");

            if (request.PublishAt is { } at && PublicationRules.ValidateSchedule(target, at, DateTimeOffset.UtcNow) is { } error)
                return ActionResponse.Fail($"{Platforms.Label(target)}: {error}");

            var row = await publications.Reschedule(id, request.PublishAt, userName, cancellationToken);
            if (row == null) return ActionResponse.Fail("La publicación no existe.");
            await Notify(id, row.VideoId, null, row.Target, row.StatusCode, cancellationToken);
            return ActionResponse.Ok(row);
        });

    /// <summary>Límites de cada plataforma para que el front valide mientras se escribe (misma fuente que la API).</summary>
    public PublicationRulesInfo Rules() => PublicationRules.Describe(links.IsAvailable, platforms.Value.Connectable);

    /// <summary>Cancela con su motivo lo pendiente de las plataformas desactivadas (Platforms:Disabled).</summary>
    public Task<int> CancelDisabledAsync(CancellationToken cancellationToken) =>
        platforms.Value.Disabled.Length == 0 ? Task.FromResult(0) : publications.DisabledCancel(platforms.Value.Disabled, cancellationToken);

    /// <summary>CSV para Excel (UTF-8 con BOM y «;» como separador, como espera Excel en español).</summary>
    public async Task<byte[]> ExportCsv(PublicationListQuery query, CancellationToken cancellationToken)
    {
        var rows = await publications.Export(query, cancellationToken);
        var csv = new System.Text.StringBuilder();
        csv.AppendLine("Id;Video;Plataforma;Cuenta;Título;Estado;Programada (UTC);Pedida (UTC);Cerrada (UTC);Intentos;Enlace;Error;Vistas;Me gusta;Comentarios;Pedida por");
        foreach (var r in rows)
        {
            csv.AppendJoin(';', [
                r.Id.ToString(), Csv(r.VideoTitle), Platforms.Label(r.Target), Csv(r.ConnectionName), Csv(r.Title), r.StatusCode,
                r.PublishAt?.UtcDateTime.ToString("yyyy-MM-dd HH:mm") ?? "", r.RequestedAt.ToString("yyyy-MM-dd HH:mm"),
                r.CompletedAt?.ToString("yyyy-MM-dd HH:mm") ?? "", r.Attempts.ToString(), Csv(r.ExternalUrl), Csv(r.ErrorMessage),
                r.Views?.ToString() ?? "", r.Likes?.ToString() ?? "", r.Comments?.ToString() ?? "", Csv(r.RequestedBy)]);
            csv.AppendLine();
        }
        return [.. System.Text.Encoding.UTF8.GetPreamble(), .. System.Text.Encoding.UTF8.GetBytes(csv.ToString())];
    }

    /// <summary>Entre comillas si hace falta; un = + - @ inicial se neutraliza (inyección de fórmulas en Excel).</summary>
    private static string Csv(string? value)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;
        string text = value.Length > 0 && "=+-@".Contains(value[0]) ? "'" + value : value;
        return text.IndexOfAny([';', '"', '\n', '\r']) >= 0 ? $"\"{text.Replace("\"", "\"\"")}\"" : text;
    }

    /// <summary>Historial de publicaciones cerradas más antiguo que <paramref name="retentionDays"/> (job de limpieza).</summary>
    public Task<int> PurgeEventsAsync(int retentionDays, CancellationToken cancellationToken) =>
        retentionDays <= 0 ? Task.FromResult(0) : activity.EventsPurge(TimeClock.UtcNow.AddDays(-retentionDays), cancellationToken);

    private static bool IsHttpUrl(string? value) =>
        string.IsNullOrWhiteSpace(value)
        || (Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp));

    public Task<NotificationsResponse> Notifications(CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<NotificationsResponse>(async () => NotificationsResponse.Ok(await activity.Notifications(30, cancellationToken)));

    public Task<CustomTransactionResponse<bool>> NotificationsRead(CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<bool>>(async () =>
        {
            await activity.NotificationsRead(cancellationToken);
            return CustomTransactionResponse<bool>.Ok(true);
        });

    private static string AccountName(ConnectionItem account) => account.Alias ?? account.DisplayName;

    private Task Notify(long id, int? videoId, int? connectionId, string target, string status, CancellationToken cancellationToken) =>
        notifier.NotifyAsync(RealTimeEntities.VideoPublish, new { publicationId = id, videoId, connectionId, target, status, percent = (int?)null, isFinal = true }, cancellationToken);
}
