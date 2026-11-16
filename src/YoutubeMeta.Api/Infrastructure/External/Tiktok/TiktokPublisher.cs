using System.Text.Json.Nodes;
using YoutubeMeta.Api.Application.Publishing;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Infrastructure.External.Tiktok;

/// <summary>
/// Content Posting API: init (directo o borrador) → PUT por trozos → el job consulta el estado.
/// La sesión (publish_id, upload_url y siguiente trozo) se guarda cifrada tras cada trozo; upload_url
/// caduca a la hora, así que solo se reanuda una sesión reciente.
/// </summary>
public sealed class TiktokPublisher(PublisherServices services, TiktokClient tiktok, TiktokTokens tokens, PlatformKeys keys)
    : PlatformPublisherBase(services)
{
    private static readonly TimeSpan UploadUrlLifetime = TimeSpan.FromMinutes(55);
    private const string ProfileUrl = "https://www.tiktok.com/";

    private sealed record Session(string PublishId, string UploadUrl, int NextChunk, long ChunkSize, int Count, DateTime CreatedAt);

    private static readonly Dictionary<string, string> PrivacyLevels = new()
    {
        [PrivacyStatus.Public] = "PUBLIC_TO_EVERYONE",
        [PrivacyStatus.Followers] = "FOLLOWER_OF_CREATOR",
        [PrivacyStatus.Friends] = "MUTUAL_FOLLOW_FRIENDS",
        [PrivacyStatus.Private] = "SELF_ONLY"
    };

    private const string Account = "La cuenta de TikTok";

    /// <summary>TikTok corta el título de una publicación de fotos a 90 caracteres; el resto va en la descripción.</summary>
    private const int PhotoTitleMax = 90;

    public override string Platform => Platforms.TikTok;

    public override async Task<PublishStep> UploadAsync(PublicationDueItem item, string filePath, string leaseOwner, UploadHeartbeat heartbeat)
    {
        CancellationToken cancellationToken = heartbeat.Token;

        var access = await tokens.AccessTokenAsync(item.ConnectionKey, cancellationToken);
        if (access.Token is not { } accessToken) return AccessFailed(access);
        if (item.PostKind != PostKinds.Video) return await PhotosAsync(item, accessToken, heartbeat);

        long fileSize = new FileInfo(filePath).Length;
        Session? session = ReadSession<Session>(item.SessionData);
        if (session != null && TimeClock.UtcNow - session.CreatedAt > UploadUrlLifetime) session = null;

        if (session is null)
        {
            var options = item.Options;
            JsonObject? postInfo = null;
            if (!options.IsTiktokInbox)
            {
                var creator = await tiktok.CreatorInfoAsync(accessToken, cancellationToken);
                if (!creator.Ok) return Classify(creator.Error!);

                var info = creator.Data!;
                string level = PrivacyLevel(item);
                if (PrivacyNotAllowed(info, level) is { } notAllowed) return notAllowed;
                if (info.MaxDurationSec > 0 && item.DurationSec > info.MaxDurationSec)
                    return PublishStep.Failed("DURATION", $"La cuenta de TikTok admite videos de hasta {info.MaxDurationSec / 60} min.");

                postInfo = new JsonObject
                {
                    ["title"] = item.Title,
                    ["privacy_level"] = level,
                    ["disable_comment"] = options.DisableComment == true || info.CommentDisabled,
                    ["disable_duet"] = options.DisableDuet == true || info.DuetDisabled,
                    ["disable_stitch"] = options.DisableStitch == true || info.StitchDisabled,
                    ["brand_content_toggle"] = options.BrandContent == true,
                    ["brand_organic_toggle"] = options.BrandOrganic == true,
                    ["is_aigc"] = options.IsAigc == true || item.ContainsSyntheticMedia
                };
            }

            var chunks = TiktokChunks.For(fileSize, (await keys.TiktokAsync(cancellationToken)).Settings.ChunkMb);
            var init = await tiktok.InitAsync(accessToken, postInfo, chunks, cancellationToken);
            if (!init.Ok) return Classify(init.Error!);

            session = new Session(init.Data.PublishId, init.Data.UploadUrl, 0, chunks.ChunkSize, chunks.Count, TimeClock.UtcNow);
            await SaveSessionAsync(item, leaseOwner, session, cancellationToken);
        }

        var plan = new TiktokChunks(fileSize, session.ChunkSize, session.Count);
        for (int index = session.NextChunk; index < plan.Count; index++)
        {
            var sent = await tiktok.UploadChunkAsync(session.UploadUrl, filePath, item.ContentType ?? "video/mp4", plan.Start(index), plan.Length(index), fileSize,
                bytes => heartbeat.Report(bytes, fileSize), cancellationToken);
            if (!sent.Ok)
            {
                if (heartbeat.LeaseLost) return PublishStep.LeaseLost();
                return sent.Error!.Code == "upload_url_expired"
                    ? PublishStep.Restart("UPLOAD_URL", "El enlace de subida de TikTok caducó; se sube de nuevo desde el inicio.")
                    : PublishStep.Retry(sent.Error.Code, sent.Error.Message);
            }

            session = session with { NextChunk = index + 1 };
            await SaveSessionAsync(item, leaseOwner, session, cancellationToken);
        }

        return PublishStep.Processing(session.PublishId, null);
    }

    /// <summary>
    /// Modo foto. TikTok empieza a publicar en cuanto recibe la petición, así que el paso irreversible se marca antes;
    /// luego se consulta el estado como con un video.
    /// </summary>
    private async Task<PublishStep> PhotosAsync(PublicationDueItem item, string accessToken, UploadHeartbeat heartbeat)
    {
        CancellationToken cancellationToken = heartbeat.Token;
        if (item.Media.Any(m => m.PublicUrl is null))
            return PublishStep.Failed("NO_PUBLIC_URL", "TikTok descarga las fotos desde una dirección pública verificada y este servidor no tiene una (App:PublicBaseUrl). " +
                                      "Publica la app en un dominio con https y verifícalo en el portal de TikTok (ver la guía).");

        var options = item.Options;
        string level = PrivacyLevel(item);
        if (!options.IsTiktokInbox)
        {
            var creator = await tiktok.CreatorInfoAsync(accessToken, cancellationToken);
            if (!creator.Ok) return Classify(creator.Error!);
            if (PrivacyNotAllowed(creator.Data!, level) is { } notAllowed) return notAllowed;
        }

        var postInfo = new JsonObject
        {
            ["title"] = item.Title.Length > PhotoTitleMax ? item.Title[..PhotoTitleMax] : item.Title,
            ["description"] = item.Description ?? string.Empty,
            ["privacy_level"] = level,
            ["disable_comment"] = options.DisableComment == true,
            ["auto_add_music"] = true,
            ["brand_content_toggle"] = options.BrandContent == true,
            ["brand_organic_toggle"] = options.BrandOrganic == true
        };

        await heartbeat.MarkCommittingAsync();
        var init = await tiktok.PhotoInitAsync(accessToken, postInfo, [.. item.Media.Select(m => m.PublicUrl!)], options.IsTiktokInbox, cancellationToken);
        if (!init.Ok) return Classify(init.Error!);
        return PublishStep.Processing(init.Data!, null);
    }

    public override async Task<PublishStep> PollAsync(PublicationPollItem item, CancellationToken cancellationToken)
    {
        var access = await tokens.AccessTokenAsync(item.ConnectionKey, cancellationToken);
        if (access.Token is not { } accessToken) return AccessFailed(access);

        var status = await tiktok.StatusAsync(accessToken, item.ExternalId, cancellationToken);
        if (!status.Ok) return Classify(status.Error!);

        switch (status.Data!.Status)
        {
            case "SEND_TO_USER_INBOX":
                return PublishStep.Done(ProfileUrl, "Borrador enviado: termínalo desde la notificación de TikTok en el móvil.");

            case "PUBLISH_COMPLETE":
                if (status.Data.PostId is null)
                    return PublishStep.Done(ProfileUrl, item.PrivacyStatus == PrivacyStatus.Private
                        ? "Publicado como privado (solo tú lo ves)."
                        : "TikTok lo publicó; el enlace aparece cuando termina la moderación.");
                var user = await tiktok.UserInfoAsync(accessToken, cancellationToken);
                return PublishStep.Done(user.Ok && user.Data!.Username.Length > 0
                    ? $"https://www.tiktok.com/@{user.Data.Username}/video/{status.Data.PostId}"
                    : ProfileUrl);

            case "FAILED":
                return PublishStep.Failed($"tiktok:{status.Data.FailReason}", FailReasonMessage(status.Data.FailReason));

            default:
                return PublishStep.StillProcessing();
        }
    }

    public override async Task<ConnectionTest> TestAsync(ConnectionRow connection, CancellationToken cancellationToken)
    {
        var access = await tokens.AccessTokenAsync(connection.ConnectionKey, cancellationToken);
        if (access.Token is not { } accessToken)
            return new(false, access.IsTransientFailure
                ? "TikTok no responde ahora mismo; se vuelve a probar más tarde."
                : "TikTok rechazó el acceso (revocado o caducado). Vuelve a conectar la cuenta.");

        var user = await tiktok.UserInfoAsync(accessToken, cancellationToken);
        return user.Ok ? new(true, $"Conexión correcta con @{user.Data!.Username}.") : new(false, Friendly(user.Error!));
    }

    public static string Friendly(TiktokError error) => error.Code switch
    {
        "access_token_invalid" or "invalid_grant" => "TikTok rechazó el acceso (revocado o caducado). Vuelve a conectar la cuenta.",
        "scope_not_authorized" => "La cuenta no concedió todos los permisos. Vuelve a conectarla y acepta publicar y subir videos.",
        "unaudited_client_can_only_post_to_private_accounts" => "Sin la auditoría de TikTok solo se puede publicar en cuentas privadas y como «Solo yo». Pon la cuenta en privado o solicita la auditoría.",
        "reached_active_user_cap" => "Sin auditoría, TikTok permite publicar con como mucho 5 cuentas al día.",
        "privacy_level_option_mismatch" => "La visibilidad elegida no está entre las que permite la cuenta.",
        "spam_risk_too_many_posts" => "La cuenta alcanzó el máximo de publicaciones diarias de TikTok.",
        "spam_risk_too_many_pending_share" => "Hay 5 borradores pendientes en la bandeja de TikTok. Termínalos o bórralos en el móvil.",
        "spam_risk_user_banned_from_posting" => "TikTok tiene bloqueada la publicación en esta cuenta.",
        _ => $"TikTok respondió: {error.Message} ({error.Code})"
    };

    private static PublishStep Classify(TiktokError error)
    {
        string tag = $"tiktok:{error.Code}";
        return error.Code switch
        {
            "access_token_invalid" or "scope_not_authorized" => PublishStep.NeedsReconnect(tag, Friendly(error)),
            "rate_limit_exceeded" => PublishStep.WaitQuota(tag, "TikTok limitó las llamadas de la app. Se reintenta solo en 5 min.", TimeClock.UtcNow.AddMinutes(5)),
            "spam_risk_too_many_posts" => PublishStep.WaitQuota(tag, $"{Friendly(error)} Se reintenta solo en 6 h.", TimeClock.UtcNow.AddHours(6)),
            "internal_error" => PublishStep.Retry(tag, "Error temporal de TikTok."),
            _ when error.HttpStatus >= 500 => PublishStep.Retry(tag, $"Error temporal de TikTok: {error.Message}"),
            _ => PublishStep.Failed(tag, Friendly(error))
        };
    }

    private static string FailReasonMessage(string? reason) => reason switch
    {
        "file_format_check_failed" => "TikTok no admite el formato. Usa MP4 o MOV (H.264).",
        "duration_check_failed" => "El video no cumple la duración que permite la cuenta de TikTok.",
        "frame_rate_check_failed" => "TikTok admite videos de 23 a 60 fotogramas por segundo.",
        "picture_size_check_failed" => "La resolución no es válida para TikTok (de 360 a 4096 píxeles por lado).",
        "publish_cancelled" => "La publicación se canceló en TikTok.",
        "auth_removed" => "Se retiró el permiso de la app en TikTok. Vuelve a conectar la cuenta.",
        _ => $"TikTok no pudo publicar el video ({reason})."
    };

    private static string PrivacyLevel(IPostContent item) => PrivacyLevels.GetValueOrDefault(item.PrivacyStatus, "SELF_ONLY");

    /// <summary>TikTok exige comprobar antes de cada publicación directa que la cuenta admite esa privacidad.</summary>
    private static PublishStep? PrivacyNotAllowed(TiktokCreatorInfo creator, string level) => creator.PrivacyOptions.Contains(level)
        ? null
        : PublishStep.Failed("PRIVACY", $"La cuenta de TikTok ya no permite esa visibilidad. Opciones actuales: {string.Join(", ", creator.PrivacyOptions)}.");

    private PublishStep AccessFailed(TiktokAccess access) => access.IsTransientFailure
        ? PublishStep.Retry("TOKEN_REFRESH", "TikTok no respondió al renovar el acceso de la cuenta. Se reintenta solo.")
        : NoTokenStep(Account);
}
