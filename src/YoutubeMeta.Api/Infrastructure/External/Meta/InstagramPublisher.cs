using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Infrastructure.External.Meta;

/// <summary>
/// Imagen y carrusel: Meta descarga cada imagen desde el enlace público firmado (App:PublicBaseUrl); los
/// contenedores se crean, se espera a que estén listos y se publican en la misma subida, marcando antes el paso
/// irreversible (un contenedor publicado queda en PUBLISHED: así se comprueba sin duplicar).
/// Reels en una cuenta profesional de Instagram con el token del usuario del sistema:
/// 1) contenedor REELS reanudable, 2) archivo binario a rupload (sin URL pública), 3) el job consulta el
/// contenedor y, cuando Meta lo termina de procesar, lo publica con media_publish. Publicar es idempotente:
/// si media_publish se corta, la siguiente consulta ve el contenedor como PUBLISHED.
/// </summary>
public sealed class InstagramPublisher(PublisherServices services, MetaGraphClient graph) : PlatformPublisherBase(services), IFirstCommentPublisher
{
    private const string ProfileUrl = "https://www.instagram.com/";
    private const string Account = "La cuenta de Instagram";
    private static readonly TimeSpan ContainerWaitMax = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan ContainerPollEvery = TimeSpan.FromSeconds(5);

    private sealed record Session(string ContainerId, string UploadUri);

    /// <summary>Contenedores de una imagen o un carrusel: hijos por archivo y el contenedor que se publica.</summary>
    private sealed class ImageSession
    {
        public Dictionary<int, string> Children { get; set; } = [];
        public string? ContainerId { get; set; }
    }

    public override string Platform => Platforms.Instagram;

    public override async Task<PublishStep> UploadAsync(PublicationDueItem item, string filePath, string leaseOwner, UploadHeartbeat heartbeat)
    {
        CancellationToken cancellationToken = heartbeat.Token;
        string igUserId = item.AccountExternalId;

        string? token = await TokenAsync(item.ConnectionKey, cancellationToken);
        if (token is null) return NoTokenStep(Account);

        if (await LimitReachedAsync(igUserId, token, cancellationToken) is { } wait) return wait;
        if (item.PostKind != PostKinds.Video) return await ImagesAsync(item, token, leaseOwner, heartbeat);

        long fileSize = new FileInfo(filePath).Length;
        long offset = 0;
        Session? session = ReadSession<Session>(item.SessionData);

        if (session != null)
        {
            // Subida cortada: se retoma desde lo que Meta ya recibió, salvo que el contenedor no sirva.
            var status = await graph.ContainerStatusAsync(session.ContainerId, token, cancellationToken);
            if (!status.Ok || status.Data!.StatusCode is "ERROR" or "EXPIRED")
                return PublishStep.Restart("CONTAINER", "El contenedor de Instagram ya no sirve; se sube de nuevo desde el inicio.");
            offset = Math.Clamp(status.Data.BytesTransferred, 0, fileSize);
        }
        else
        {
            var created = await graph.CreateReelContainerAsync(igUserId, token, item.Description, item.Options.ShareToFeed ?? true, cancellationToken);
            if (!created.Ok) return Classify(created.Error!);

            session = new Session(created.Data.ContainerId, created.Data.UploadUri);
            await SaveSessionAsync(item, leaseOwner, session, cancellationToken);
        }

        if (offset < fileSize)
        {
            var sent = await graph.UploadReelAsync(session.UploadUri, token, filePath, offset, fileSize, bytes => heartbeat.Report(bytes, fileSize), cancellationToken);
            if (!sent.Ok)
            {
                if (heartbeat.LeaseLost) return PublishStep.LeaseLost();
                return sent.Error!.IsTransient
                    ? PublishStep.Retry("UPLOAD", $"Se cortó la subida a Instagram: {sent.Error.Message}. Se retoma sola.")
                    : Classify(sent.Error);
            }
        }

        return PublishStep.Processing(session.ContainerId, null);
    }

    /// <summary>Meta recomienda consultar cada minuto; al terminar se publica en el mismo paso.</summary>
    public override async Task<PublishStep> PollAsync(PublicationPollItem item, CancellationToken cancellationToken)
    {
        string? token = await TokenAsync(item.ConnectionKey, cancellationToken);
        if (token is null) return NoTokenStep(Account);

        var status = await graph.ContainerStatusAsync(item.ExternalId, token, cancellationToken);
        if (!status.Ok) return Classify(status.Error!);

        switch (status.Data!.StatusCode)
        {
            case "IN_PROGRESS":
                return PublishStep.StillProcessing();
            case "ERROR":
                return PublishStep.Failed("container:ERROR",
                    $"Instagram no pudo procesar el video. {status.Data.Status} Comprueba que sea MP4 (H.264 + AAC), vertical 9:16, de 3 s a 15 min.".Trim());
            case "EXPIRED":
                return PublishStep.Restart("container:EXPIRED", "El contenedor de Instagram caducó (24 h sin publicar); se sube de nuevo solo.");
            case "PUBLISHED":
                return PublishStep.Done(item.ExternalUrl ?? ProfileUrl);
        }

        var published = await graph.MediaPublishAsync(item.AccountExternalId, token, item.ExternalId, cancellationToken);
        if (!published.Ok) return Classify(published.Error!);

        string? permalink = await graph.MediaPermalinkAsync(published.Data!, token, cancellationToken);
        return PublishStep.Done(permalink ?? ProfileUrl, externalId: published.Data);
    }

    /// <summary>Imagen suelta o carrusel (hasta 10). Todo en la misma subida.</summary>
    private async Task<PublishStep> ImagesAsync(PublicationDueItem item, string token, string leaseOwner, UploadHeartbeat heartbeat)
    {
        CancellationToken cancellationToken = heartbeat.Token;
        if (item.Media.Any(m => m.PublicUrl is null))
            return PublishStep.Failed("NO_PUBLIC_URL", "Instagram descarga las imágenes desde una dirección pública y este servidor no tiene una (App:PublicBaseUrl). " +
                                      "Publica la app en un dominio con https y vuelve a intentarlo.");

        var session = ReadSession<ImageSession>(item.SessionData) ?? new ImageSession();
        string igUserId = item.AccountExternalId;
        bool carousel = item.PostKind == PostKinds.Carousel;

        if (session.ContainerId is null)
        {
            if (carousel)
            {
                foreach (var media in item.Media)
                {
                    if (session.Children.ContainsKey(media.Id)) continue;
                    var child = await graph.CreateImageContainerAsync(igUserId, token, media.PublicUrl!, null, true, media.AltText, cancellationToken);
                    if (!child.Ok) return Classify(child.Error!);
                    session.Children[media.Id] = child.Data!;
                    await SaveSessionAsync(item, leaseOwner, session, cancellationToken);
                }
                foreach (string childId in session.Children.Values)
                    if (await WaitContainerAsync(childId, token, cancellationToken) is { } notReady) return notReady;

                var container = await graph.CreateCarouselContainerAsync(igUserId, token, [.. item.Media.Select(m => session.Children[m.Id])], item.Description, cancellationToken);
                if (!container.Ok) return Classify(container.Error!);
                session.ContainerId = container.Data;
            }
            else
            {
                var media = item.Media[0];
                var container = await graph.CreateImageContainerAsync(igUserId, token, media.PublicUrl!, item.Description, false, media.AltText, cancellationToken);
                if (!container.Ok) return Classify(container.Error!);
                session.ContainerId = container.Data;
            }
            await SaveSessionAsync(item, leaseOwner, session, cancellationToken);
        }

        if (await WaitContainerAsync(session.ContainerId!, token, cancellationToken) is { } waiting) return waiting;

        await heartbeat.MarkCommittingAsync();
        var published = await graph.MediaPublishAsync(igUserId, token, session.ContainerId!, cancellationToken);
        if (!published.Ok) return Classify(published.Error!);

        string? permalink = await graph.MediaPermalinkAsync(published.Data!, token, cancellationToken);
        return PublishStep.Done(permalink ?? ProfileUrl, externalId: published.Data);
    }

    /// <summary>null = listo (FINISHED). Si Meta tarda, se reintenta más tarde con los mismos contenedores.</summary>
    private async Task<PublishStep?> WaitContainerAsync(string containerId, string token, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow + ContainerWaitMax;
        while (true)
        {
            var status = await graph.ContainerStatusAsync(containerId, token, cancellationToken);
            if (!status.Ok) return Classify(status.Error!);
            switch (status.Data!.StatusCode)
            {
                case "FINISHED" or "PUBLISHED":
                    return null;
                case "ERROR":
                    return PublishStep.Failed("container:ERROR",
                        $"Instagram no pudo descargar o procesar una imagen. {status.Data.Status} Usa JPEG de hasta 8 MB y comprueba que el servidor sea accesible desde Internet.".Trim());
                case "EXPIRED":
                    return PublishStep.Restart("container:EXPIRED", "El contenedor de Instagram caducó; se crea de nuevo solo.");
            }
            if (DateTime.UtcNow >= deadline) return PublishStep.Retry("CONTAINER", "Instagram sigue preparando las imágenes. Se reintenta solo.");
            await Task.Delay(ContainerPollEvery, cancellationToken);
        }
    }

    /// <summary>Imágenes: si el contenedor ya está PUBLISHED, se publicó. Reels: no pasan por aquí (se publican al consultar).</summary>
    public override async Task<PublishStep?> VerifyAsync(PublicationDueItem item, CancellationToken cancellationToken)
    {
        if (item.PostKind == PostKinds.Video) return UnverifiableStep();
        var session = ReadSession<ImageSession>(item.SessionData);
        if (session?.ContainerId is null) return null;

        string? token = await TokenAsync(item.ConnectionKey, cancellationToken);
        if (token is null) return NoTokenStep(Account);

        var status = await graph.ContainerStatusAsync(session.ContainerId, token, cancellationToken);
        if (!status.Ok) return UnverifiableStep();
        return status.Data!.StatusCode == "PUBLISHED" ? PublishStep.Done(ProfileUrl) : null;
    }

    public async Task<CommentResult> CommentAsync(CommentRequest request, CancellationToken cancellationToken)
    {
        string? token = await TokenAsync(request.ConnectionKey, cancellationToken);
        if (token is null) return CommentResult.Fail("la cuenta no tiene un acceso válido; vuelve a conectarla.");

        var result = await graph.CommentAsync(request.PostExternalId, token, request.Text, cancellationToken);
        return result.Ok ? CommentResult.Ok(result.Data!) : CommentResult.Fail(FacebookPublisher.CommentError(result.Error!));
    }

    public override async Task<ConnectionTest> TestAsync(ConnectionRow connection, CancellationToken cancellationToken)
    {
        string? token = Services.Protector.UnprotectOrNull(connection.SecretCipher);
        if (token == null) return new(false, "No hay token guardado: vuelve a conectar la cuenta.");

        var account = await graph.InstagramAccountAsync(connection.ExternalId, token, cancellationToken);
        if (!account.Ok) return new(false, MetaErrorClassifier.Friendly(account.Error!));

        var limit = await graph.PublishingLimitAsync(connection.ExternalId, token, cancellationToken);
        string usage = limit.Ok && limit.Data.Total != int.MaxValue ? $" Publicaciones por API en 24 h: {limit.Data.Used} de {limit.Data.Total}." : string.Empty;
        return new(true, $"Conexión correcta con @{account.Data!.Username}.{usage}");
    }

    /// <summary>Códigos propios de Instagram (2207xxx); el resto, como Facebook.</summary>
    private static PublishStep Classify(MetaError error)
    {
        string tag = error.Subcode is { } sub ? $"{error.Code}/{sub}" : error.Code.ToString();
        return error.Subcode switch
        {
            2207042 => PublishStep.WaitQuota(tag, "Instagram alcanzó su límite de publicaciones por API en 24 h. Se reintenta solo en una hora.", TimeClock.UtcNow.AddHours(1)),
            2207027 => PublishStep.StillProcessing(),
            2207026 => PublishStep.Failed(tag, "Instagram no admite el formato del video. Usa MP4 (H.264 + AAC), vertical 9:16, de 3 s a 15 min."),
            2207050 => PublishStep.Failed(tag, "La cuenta de Instagram está restringida. Revísala en la app de Instagram y pulsa «Reintentar»."),
            2207020 or 2207008 or 2207053 => PublishStep.Restart(tag, "Instagram descartó la subida; se vuelve a subir desde el inicio."),
            2207001 or 2207003 or 2207032 => PublishStep.Retry(tag, $"Error temporal de Instagram: {error.Message}"),
            _ => MetaErrorClassifier.Classify(error)
        };
    }

    private async Task<PublishStep?> LimitReachedAsync(string igUserId, string token, CancellationToken cancellationToken)
    {
        var limit = await graph.PublishingLimitAsync(igUserId, token, cancellationToken);
        if (!limit.Ok || limit.Data.Used < limit.Data.Total) return null;
        return PublishStep.WaitQuota("PUBLISHING_LIMIT",
            $"La cuenta ya publicó {limit.Data.Used} de {limit.Data.Total} videos por API en 24 h. Se reintenta solo en una hora.",
            TimeClock.UtcNow.AddHours(1));
    }
}
