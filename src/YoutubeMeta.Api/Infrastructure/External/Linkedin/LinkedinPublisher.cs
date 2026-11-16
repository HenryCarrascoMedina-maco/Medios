using System.Text.Json.Nodes;
using YoutubeMeta.Api.Application.Publishing;

namespace YoutubeMeta.Api.Infrastructure.External.Linkedin;

/// <summary>
/// Publica en un perfil o una página de empresa de LinkedIn: texto, enlace, imagen, varias imágenes, video y PDF.
/// Todo ocurre en la subida (no hay consulta de estado aparte):
/// <list type="number">
/// <item>Se suben los archivos y sus URN se guardan en la sesión: un reintento no vuelve a subir lo ya subido.</item>
/// <item>Se espera a que LinkedIn los procese (AVAILABLE). Si tarda más de lo configurado, se reintenta más tarde
/// sin volver a subir nada.</item>
/// <item>Se marca el paso irreversible y se crea el post. Si se corta ahí, el job comprueba antes de repetir: en
/// páginas de empresa lo busca en sus últimos posts; en perfiles no se puede (permiso restringido) y pasa a revisión.</item>
/// </list>
/// </summary>
public sealed class LinkedinPublisher(
        PublisherServices services,
        LinkedinClient linkedin,
        LinkedinTokens tokens,
        PlatformKeys keys,
        IOptions<LinkedinSettings> settings,
        ILogger<LinkedinPublisher> logger) : PlatformPublisherBase(services), IFirstCommentPublisher
{
    private static readonly TimeSpan AssetPollEvery = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan ImageWaitMax = TimeSpan.FromMinutes(2);

    private sealed class Session
    {
        /// <summary>Id del archivo de la biblioteca → URN en LinkedIn (imagen, documento o video ya subido).</summary>
        public Dictionary<int, string> Assets { get; set; } = [];
    }

    public override string Platform => Platforms.LinkedIn;

    public override async Task<PublishStep> UploadAsync(PublicationDueItem item, string filePath, string leaseOwner, UploadHeartbeat heartbeat)
    {
        CancellationToken cancellationToken = heartbeat.Token;
        var access = await tokens.AccessAsync(item.ConnectionKey, cancellationToken);
        if (access.Token is not { } token) return PublishStep.NeedsReconnect("TOKEN", access.Problem!);

        string version = await VersionAsync(access.Data!, cancellationToken);
        string author = item.AccountExternalId;
        var session = ReadSession<Session>(item.SessionData) ?? new Session();
        var ctx = new UploadContext(item, author, token, version, session, leaseOwner, heartbeat);

        JsonObject? content;
        switch (item.PostKind)
        {
            case PostKinds.Text:
                content = null;
                break;

            case PostKinds.Link:
                content = new JsonObject { ["article"] = new JsonObject { ["source"] = item.LinkUrl, ["title"] = item.Title } };
                break;

            case PostKinds.Image or PostKinds.Carousel:
            {
                var images = new JsonArray();
                foreach (var media in item.Media)
                {
                    var (urn, failed) = await EnsureAssetAsync(ctx, media, LinkedinResources.Images, ImageWaitMax);
                    if (failed != null) return failed;
                    images.Add(new JsonObject { ["id"] = urn, ["altText"] = media.AltText ?? string.Empty });
                }
                content = images.Count == 1
                    ? new JsonObject { ["media"] = new JsonObject { ["id"] = images[0]!["id"]!.GetValue<string>(), ["altText"] = images[0]!["altText"]!.GetValue<string>() } }
                    : new JsonObject { ["multiImage"] = new JsonObject { ["images"] = images } };
                break;
            }

            case PostKinds.Document or PostKinds.Video:
            {
                string resource = item.PostKind == PostKinds.Video ? LinkedinResources.Videos : LinkedinResources.Documents;
                var (urn, failed) = await EnsureAssetAsync(ctx, item.Media[0], resource, TimeSpan.FromMinutes(Math.Max(settings.Value.MaxVideoWaitMinutes, 1)));
                if (failed != null) return failed;
                content = new JsonObject { ["media"] = new JsonObject { ["id"] = urn, ["title"] = item.Title } };
                break;
            }

            default:
                return PublishStep.Failed("UNSUPPORTED", $"LinkedIn no admite publicaciones de tipo {PostKinds.Label(item.PostKind)}.");
        }

        await heartbeat.MarkCommittingAsync();
        var post = new LinkedinPost(author, PostText(item), Visibility(item.PrivacyStatus, author), content);
        var created = await linkedin.CreatePostAsync(post, token, version, cancellationToken);
        if (!created.Ok)
        {
            // Un error de red o 5xx justo aquí es un resultado dudoso: se comprueba en vez de repetir.
            if (created.Error!.IsTransient) return await VerifyAsync(item, cancellationToken) ?? Classify(created.Error);
            return Classify(created.Error);
        }

        return PublishStep.Done(LinkedinClient.PostUrl(created.Data!), externalId: created.Data);
    }

    /// <summary>No hay consulta de estado: todo se resuelve en la subida.</summary>
    public override Task<PublishStep> PollAsync(PublicationPollItem item, CancellationToken cancellationToken) =>
        Task.FromResult(PublishStep.Done(item.ExternalUrl ?? (item.ExternalId.Length > 0 ? LinkedinClient.PostUrl(item.ExternalId) : null)));

    /// <summary>
    /// Páginas de empresa: busca el post entre los últimos del autor (mismo texto, creado después de empezar). Perfiles:
    /// LinkedIn no deja leer los posts de una persona sin un permiso restringido, así que decide una persona.
    /// </summary>
    public override async Task<PublishStep?> VerifyAsync(PublicationDueItem item, CancellationToken cancellationToken)
    {
        if (!item.AccountExternalId.StartsWith("urn:li:organization:", StringComparison.Ordinal)) return UnverifiableStep();

        var access = await tokens.AccessAsync(item.ConnectionKey, cancellationToken);
        if (access.Token is not { } token) return UnverifiableStep();

        var recent = await linkedin.RecentPostsAsync(item.AccountExternalId, token, await VersionAsync(access.Data!, cancellationToken), cancellationToken);
        if (!recent.Ok) return UnverifiableStep();

        string expected = LinkedinClient.Commentary(PostText(item));
        long since = VerifySince(item).ToUnixTimeMilliseconds();
        var match = recent.Data!.FirstOrDefault(p => p.CreatedAtMs >= since && (p.Commentary == expected || p.Commentary == PostText(item)));
        return match != null ? PublishStep.Done(LinkedinClient.PostUrl(match.Urn), externalId: match.Urn) : null;
    }

    public async Task<CommentResult> CommentAsync(CommentRequest request, CancellationToken cancellationToken)
    {
        var access = await tokens.AccessAsync(request.ConnectionKey, cancellationToken);
        if (access.Token is not { } token) return CommentResult.Fail(access.Problem!);

        var result = await linkedin.CommentAsync(request.AccountExternalId, request.PostExternalId, request.Text, token,
            await VersionAsync(access.Data!, cancellationToken), cancellationToken);
        return result.Ok ? CommentResult.Ok(result.Data!) : CommentResult.Fail(Friendly(result.Error!));
    }

    public override async Task<ConnectionTest> TestAsync(ConnectionRow connection, CancellationToken cancellationToken)
    {
        var access = await tokens.AccessAsync(connection.ConnectionKey, cancellationToken);
        if (access.Token is not { } token) return new(false, access.Problem!);

        var data = access.Data!;
        string version = await VersionAsync(data, cancellationToken);
        if (data.IsOrganization)
        {
            var pages = await linkedin.OrganizationsAsync(token, version, cancellationToken);
            if (!pages.Ok) return new(false, Friendly(pages.Error!));
            if (pages.Data!.All(p => p.Urn != connection.ExternalId))
                return new(false, "Ya no eres administrador de esta página en LinkedIn. Pide que te devuelvan el rol o quita la cuenta.");
        }
        else
        {
            var member = await linkedin.MemberAsync(token, version, cancellationToken);
            if (!member.Ok) return new(false, Friendly(member.Error!));
        }

        int days = (int)Math.Floor((data.ExpiresAtUtc - DateTime.UtcNow).TotalDays);
        string expiry = data.RefreshToken is { Length: > 0 } ? " El acceso se renueva solo."
            : days <= 10 ? $" Atención: el acceso caduca en {Math.Max(days, 0)} días; reconecta la cuenta antes para no cortar las publicaciones."
            : $" El acceso caduca en {days} días (LinkedIn pide reconectar cada 60).";
        return new(true, $"Conexión correcta con {connection.DisplayName}.{expiry}");
    }

    public override PublishStep Classify(Exception exception) =>
        exception is HttpRequestException ? PublishStep.Network(Label) : base.Classify(exception);

    #region ARCHIVOS
    private sealed record UploadContext(PublicationDueItem Item, string Author, string Token, string Version, Session Session, string LeaseOwner, UploadHeartbeat Heartbeat);

    /// <summary>Sube el archivo (si no estaba ya en la sesión) y espera a que LinkedIn lo deje disponible.</summary>
    private async Task<(string Urn, PublishStep? Failed)> EnsureAssetAsync(UploadContext ctx, PostMediaItem media, string resource, TimeSpan waitMax)
    {
        CancellationToken cancellationToken = ctx.Heartbeat.Token;
        if (!ctx.Session.Assets.TryGetValue(media.Id, out string? urn))
        {
            var uploaded = resource == LinkedinResources.Videos
                ? await UploadVideoAsync(ctx, media)
                : await UploadSimpleAsync(ctx, media, resource);
            if (uploaded.Failed != null) return (string.Empty, uploaded.Failed);

            urn = uploaded.Urn;
            ctx.Session.Assets[media.Id] = urn;
            await SaveSessionAsync(ctx.Item, ctx.LeaseOwner, ctx.Session, cancellationToken);
        }

        var deadline = DateTime.UtcNow + waitMax;
        while (true)
        {
            var status = await linkedin.AssetStatusAsync(resource, urn, ctx.Token, ctx.Version, cancellationToken);
            if (!status.Ok)
            {
                // El recurso ya no existe (caducó sin usarse): se sube de nuevo desde cero.
                if (status.Error!.HttpStatus == 404)
                    return (string.Empty, PublishStep.Restart("ASSET_GONE", "LinkedIn descartó un archivo subido; se sube de nuevo."));
                return (string.Empty, Classify(status.Error));
            }

            switch (status.Data)
            {
                case "AVAILABLE":
                    return (urn, null);
                case "PROCESSING_FAILED" or "CLIENT_ERROR":
                    return (string.Empty, PublishStep.Failed("PROCESSING_FAILED", resource == LinkedinResources.Videos
                        ? "LinkedIn no pudo procesar el video. Usa MP4 (H.264 + AAC), de 3 s a 30 min y hasta 500 MB."
                        : "LinkedIn no pudo procesar el archivo. Comprueba que no esté dañado y vuelve a intentarlo."));
            }

            if (DateTime.UtcNow >= deadline)
                return (string.Empty, PublishStep.Retry("PROCESSING", "LinkedIn sigue procesando el archivo. Se reintenta más tarde sin volver a subirlo."));
            await Task.Delay(AssetPollEvery, cancellationToken);
        }
    }

    private async Task<(string Urn, PublishStep? Failed)> UploadSimpleAsync(UploadContext ctx, PostMediaItem media, string resource)
    {
        CancellationToken cancellationToken = ctx.Heartbeat.Token;
        var target = await linkedin.InitializeUploadAsync(resource, ctx.Author, ctx.Token, ctx.Version, cancellationToken);
        if (!target.Ok) return (string.Empty, Classify(target.Error!));

        var sent = await linkedin.UploadPartAsync(target.Data!.UploadUrl, media.FullPath, 0, media.SizeBytes, ctx.Token,
            bytes => ctx.Heartbeat.Report(bytes, media.SizeBytes), cancellationToken);
        return sent.Ok ? (target.Data.Urn, null) : (string.Empty, UploadFailed(ctx, sent.Error!));
    }

    private async Task<(string Urn, PublishStep? Failed)> UploadVideoAsync(UploadContext ctx, PostMediaItem media)
    {
        CancellationToken cancellationToken = ctx.Heartbeat.Token;
        var init = await linkedin.InitializeVideoAsync(ctx.Author, media.SizeBytes, ctx.Token, ctx.Version, cancellationToken);
        if (!init.Ok) return (string.Empty, Classify(init.Error!));

        var etags = new List<string>();
        long done = 0;
        foreach (var part in init.Data!.Parts.OrderBy(p => p.FirstByte))
        {
            long length = part.LastByte - part.FirstByte + 1;
            long before = done;
            var sent = await linkedin.UploadPartAsync(part.UploadUrl, media.FullPath, part.FirstByte, length, ctx.Token,
                bytes => ctx.Heartbeat.Report(before + bytes, media.SizeBytes), cancellationToken);
            if (!sent.Ok) return (string.Empty, UploadFailed(ctx, sent.Error!));
            etags.Add(sent.Data!);
            done += length;
        }

        var finalized = await linkedin.FinalizeVideoAsync(init.Data.VideoUrn, init.Data.UploadToken, etags, ctx.Token, ctx.Version, cancellationToken);
        return finalized.Ok ? (init.Data.VideoUrn, null) : (string.Empty, Classify(finalized.Error!));
    }

    private PublishStep UploadFailed(UploadContext ctx, LinkedinError error)
    {
        if (ctx.Heartbeat.LeaseLost) return PublishStep.LeaseLost();
        return error.IsTransient ? PublishStep.Retry("UPLOAD", $"Se cortó la subida a LinkedIn ({error.Message}). Se reintenta sola.") : Classify(error);
    }
    #endregion

    #region TRADUCCIONES
    private async Task<string> VersionAsync(LinkedinToken token, CancellationToken cancellationToken) =>
        (await keys.LinkedinAsync(token.IsOrganization, cancellationToken)).Settings.ApiVersion;

    /// <summary>El texto del post: la descripción o, si está vacía, el título.</summary>
    /// <summary>Una página de empresa siempre publica en abierto; un perfil puede limitarlo a sus contactos.</summary>
    private static string Visibility(string privacy, string author) =>
        privacy == PrivacyStatus.Connections && author.StartsWith("urn:li:person:", StringComparison.Ordinal) ? "CONNECTIONS" : "PUBLIC";

    private PublishStep Classify(LinkedinError error)
    {
        string tag = $"linkedin:{error.HttpStatus}:{error.Code}";
        logger.LogWarning("LinkedIn respondió {Status} {Code}: {Message}", error.HttpStatus, error.Code, error.Message);
        return error.HttpStatus switch
        {
            401 => PublishStep.NeedsReconnect(tag, LinkedinTokens.ExpiredMessage),
            403 => PublishStep.Failed(tag, "LinkedIn no dio permiso para publicar en esta cuenta. " +
                   "En un perfil, la app necesita «Share on LinkedIn»; en una página, la Community Management API aprobada y que seas administrador. Revisa la guía de LinkedIn."),
            429 => PublishStep.WaitQuota(tag, "LinkedIn alcanzó su límite de publicaciones por día para esta cuenta. Se reintenta sola en una hora.", TimeClock.UtcNow.AddHours(1)),
            422 or 400 => PublishStep.Failed(tag, $"LinkedIn rechazó la publicación: {Friendly(error)}"),
            404 => PublishStep.Failed(tag, "LinkedIn no encontró la cuenta o el recurso. Vuelve a conectar la cuenta."),
            _ when error.IsTransient => PublishStep.Retry(tag, $"LinkedIn no responde bien ahora mismo ({error.HttpStatus}). Se reintenta sola."),
            _ => PublishStep.Failed(tag, $"LinkedIn respondió con un error: {Friendly(error)}")
        };
    }

    private static string Friendly(LinkedinError error) => error.HttpStatus switch
    {
        401 => LinkedinTokens.ExpiredMessage,
        403 => "LinkedIn no concedió permiso para esta acción. Revisa los productos de la app y tu rol en la página.",
        _ => string.IsNullOrWhiteSpace(error.Message) ? $"error {error.HttpStatus} ({error.Code})." : error.Message
    };
    #endregion
}
