/* =====================================================================================================================
   YoutubeMeta · 002 · Procedimientos almacenados
   Autor:   Henry Carrasco
   Fecha:   12/11/2026 · varias cuentas y plataformas: 13/11/2026 · fiabilidad de la cola y revisión: 15/11/2026 ·
            bandeja e inicio: 16/11/2026
   Orden:   001-esquema -> 002 (este). Base anterior: (003) -> 004 -> 005 -> 006-publicaciones -> 007-teams -> 008-bandeja ->
            009-contactos-invitaciones -> 010-plantillas -> 002 (este).
   Requiere: el esquema de 006 (Media_Assets, Posts, Post_Media, Publications con PostId, Publication_Events…).

   Qué hace
   0. Funciones:      UFN_PLATFORM_LABEL, UFN_PUBLICATION_START (cuándo sale una publicación programada)
   1. Biblioteca:     USP_VIDEO_CREATE / LIST / GET / UPDATE / DELETE / STORAGE_USED (medios: video, imagen, PDF)
                      USP_POST_CREATE (lo que se publica: tipo, enlace y medios en orden)
   2. Publicaciones:  USP_PUBLICATION_SAVE / LIST / EVENT_LIST / RETRY / CANCEL / RESOLVE. Destino = una cuenta concreta.
                      RESOLVE decide a mano un resultado dudoso (NEEDS_REVIEW): ya está publicado / publicar de nuevo.
   3. Job (cola):     USP_BG_PUBLICATION_DUE_LIST / POLL_DUE_LIST / LEASE_EXTEND / COMMIT_MARK / SESSION_SAVE / RESULT,
                      USP_BG_EVENT_PURGE (retención del historial)
                      Patrón de MarketingTelegram: UPDLOCK + READPAST + ROWLOCK y lease (LeaseOwner / LeaseUntil).
                      Toda escritura del job exige LeaseOwner = el suyo: si otro proceso tomó la fila, 0 filas.
   4. Conexiones:     USP_CONNECTION_LIST / GET / ACTIVE_LIST / SAVE / DEFAULT_SET / ALIAS_SAVE / DELETE / TEST_SAVE /
                      TOKEN_GET / TOKEN_SAVE / MARK_RECONNECT
                      Varias cuentas por plataforma. SAVE añade la cuenta o, si ya estaba, la reconecta (lo que
                      esperaba la reconexión continúa). Quitar una cuenta solo cancela lo pendiente de esa cuenta.
   5. Claves:         USP_CREDENTIAL_LIST / GET / SAVE / DELETE (Google, TikTok, bots de Telegram)
   6. Avisos y cuota: USP_NOTIFICATION_LIST / READ, USP_BG_QUOTA_ADD, USP_QUOTA_GET
   7. Biblioteca+:    USP_TAG_LIST, USP_VIDEO_TAGS_SET, USP_VIDEO_POSTER_SAVE, USP_TEMPLATE_LIST / SAVE / DELETE / USED (plantillas propias
                      con adjuntos: de publicación y respuestas de la bandeja),
                      USP_HASHTAG_BLOCK_LIST / SAVE / DELETE, USP_CONNECTION_SIGNATURE_SAVE
   8. Calendario:     USP_PUBLICATION_CALENDAR / RESCHEDULE
   9. Resultados:     USP_BG_METRICS_DUE_LIST / SAVE, USP_INSIGHTS, USP_SYSTEM_HEALTH,
                      USP_BG_PUBLICATION_DISABLED_CANCEL (plataformas desactivadas en la configuración)
  10. Bandeja:        USP_INBOX_EVENT_SAVE / RECENT, USP_BG_INBOX_EVENT_DUE_LIST / RESULT, USP_BG_INBOX_INGEST,
                      USP_BG_INBOX_STATUS_SAVE, USP_INBOX_CONVERSATION_LIST / UPDATE, USP_INBOX_COUNTS,
                      USP_INBOX_MESSAGE_LIST / CREATE / RESOLVE, USP_BG_INBOX_SEND_DUE_LIST / RESULT,
                      USP_INBOX_CONTACT_GET / LIST / LINK / CREATE, USP_INBOX_CONVERSATION_START,
                      USP_INBOX_INVITE_CREATE, USP_BG_INBOX_INVITE_CLAIM, USP_BG_INBOX_MESSAGE_ATTACHMENTS_SAVE,
                      USP_INBOX_ACCOUNT_LIST / SETTINGS_SAVE, USP_INBOX_SYNC_SAVE, USP_INBOX_PUBLICATIONS_RECENT,
                      USP_INBOX_STATS, USP_BG_INBOX_PURGE
  11. Inicio:         USP_HOME_SUMMARY (panel principal en una sola llamada)

   Errores 50001-50099 = mensaje para el usuario (la API lo muestra tal cual). Fechas en UTC.
   Idempotente (CREATE OR ALTER).
   ===================================================================================================================== */

SET NOCOUNT ON;
SET NOEXEC OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------------------------------------------------------------------------------------------------------------------
   0. PRE-CHEQUEO
   --------------------------------------------------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Platform_Credentials', N'U') IS NULL OR COL_LENGTH(N'dbo.Publications', N'PostId') IS NULL
   OR OBJECT_ID(N'dbo.Media_Tags', N'U') IS NULL OR OBJECT_ID(N'dbo.Post_Media', N'U') IS NULL
   OR OBJECT_ID(N'dbo.Inbox_Messages', N'U') IS NULL OR OBJECT_ID(N'dbo.Templates', N'U') IS NULL
BEGIN
    RAISERROR(N'Falta el esquema actual: base nueva = 001; base anterior = 003 (si aplica), 004, 005, 006, 007, 008, 009 y 010.', 16, 1);
    SET NOEXEC ON;
END
ELSE
    PRINT N'0. Pre-chequeo OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   0. FUNCIONES
   --------------------------------------------------------------------------------------------------------------------- */
/* Nombre visible de la plataforma para los mensajes de eventos y errores. */
CREATE OR ALTER FUNCTION dbo.UFN_PLATFORM_LABEL (@Platform VARCHAR(20))
RETURNS NVARCHAR(20)
AS
BEGIN
    RETURN CASE @Platform
        WHEN 'YOUTUBE' THEN N'YouTube'
        WHEN 'FACEBOOK' THEN N'Facebook'
        WHEN 'INSTAGRAM' THEN N'Instagram'
        WHEN 'TELEGRAM' THEN N'Telegram'
        WHEN 'TIKTOK' THEN N'TikTok'
        WHEN 'LINKEDIN' THEN N'LinkedIn'
        WHEN 'TEAMS' THEN N'Teams'
        WHEN 'WHATSAPP' THEN N'WhatsApp'
        ELSE @Platform
    END;
END
GO

/*
   Cuándo puede salir una publicación. YouTube y Facebook programan en la propia plataforma (se sube ya);
   Instagram, Telegram, TikTok, LinkedIn y Teams no lo permiten por API, así que el job la retiene hasta PublishAt.
*/
CREATE OR ALTER FUNCTION dbo.UFN_PUBLICATION_START (@Target VARCHAR(20), @PublishAt DATETIMEOFFSET(0), @CurrentDate DATETIME2(3))
RETURNS DATETIME2(3)
AS
BEGIN
    RETURN IIF(@Target IN ('INSTAGRAM', 'TELEGRAM', 'TIKTOK', 'LINKEDIN', 'TEAMS') AND @PublishAt > TODATETIMEOFFSET(@CurrentDate, 0),
               CONVERT(DATETIME2(3), SWITCHOFFSET(@PublishAt, '+00:00')),
               @CurrentDate);
END
GO

PRINT N'0. Funciones OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   1. BIBLIOTECA
   --------------------------------------------------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.USP_VIDEO_CREATE
    @Title            NVARCHAR(200),
    @OriginalFileName NVARCHAR(260),
    @StoragePath      NVARCHAR(400),
    @PosterPath       NVARCHAR(400)  = NULL,
    @ContentType      VARCHAR(100),
    @SizeBytes        BIGINT,
    @DurationSec      DECIMAL(10, 3) = NULL,
    @Width            INT            = NULL,
    @Height           INT            = NULL,
    @MediaKind        VARCHAR(10)    = 'VIDEO',
    @UserName         NVARCHAR(100),
    @CurrentDate      DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    -- Idempotente: si la finalización TUS se repite (reciclado de IIS), devuelve el video ya registrado.
    DECLARE @Id INT = (SELECT Id FROM dbo.Media_Assets WHERE StoragePath = @StoragePath);

    IF @Id IS NULL
    BEGIN
        INSERT INTO dbo.Media_Assets (Title, OriginalFileName, StoragePath, PosterPath, ContentType, SizeBytes, DurationSec, Width, Height, MediaKind, StatusCode, CreatedBy, CreatedAt)
        VALUES (LEFT(@Title, 200), LEFT(@OriginalFileName, 260), @StoragePath, @PosterPath, @ContentType, @SizeBytes, @DurationSec, @Width, @Height, @MediaKind, 'READY', @UserName, @CurrentDate);
        SET @Id = SCOPE_IDENTITY();
    END

    SELECT @Id AS Id;
END
GO

/* Lista (o un video con @Id) con el estado de su última publicación en cada cuenta (JSON). */
/*
   Biblioteca con filtros, orden y paginación (todo opcional: sin @Take devuelve todo).
   @Status: UNPUBLISHED (nada vivo ni publicado), PUBLISHED, ERROR (fallida, reconexión o revisión), SCHEDULED
            (fecha futura), ACTIVE (en cola o subiendo). Se mira la última publicación de cada cuenta, sin canceladas.
   @Sort:   NEWEST (por defecto), OLDEST, TITLE, SIZE, DURATION.  TotalCount = filas antes de paginar.
*/
CREATE OR ALTER PROCEDURE dbo.USP_VIDEO_LIST
    @Id          INT           = NULL,
    @SearchTerm  NVARCHAR(200) = NULL,
    @Status      VARCHAR(20)   = NULL,
    @Platform    VARCHAR(20)   = NULL,
    @Tag         NVARCHAR(50)  = NULL,
    @Kind        VARCHAR(10)   = NULL,
    @Sort        VARCHAR(20)   = NULL,
    @Offset      INT           = 0,
    @Take        INT           = NULL,
    @CurrentDate DATETIME2(3)  = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Now DATETIMEOFFSET(0) = TODATETIMEOFFSET(COALESCE(@CurrentDate, SYSUTCDATETIME()), 0);

    SELECT
        V.Id,
        V.Title,
        V.OriginalFileName,
        V.ContentType,
        V.SizeBytes,
        V.DurationSec,
        V.Width,
        V.Height,
        V.MediaKind,
        CAST(IIF(V.PosterPath IS NOT NULL OR V.MediaKind = 'IMAGE', 1, 0) AS BIT) AS HasPoster,
        V.CreatedBy,
        V.CreatedAt,
        V.StoragePath,
        (SELECT STRING_AGG(T.Tag, N',') WITHIN GROUP (ORDER BY T.Tag) FROM dbo.Media_Tags AS T WHERE T.VideoId = V.Id) AS TagsCsv,
        COUNT(*) OVER () AS TotalCount,
        (SELECT L.Id AS PublicationId, L.ConnectionId, L.Target, COALESCE(C.Alias, C.DisplayName) AS ConnectionName,
                C.AvatarUrl, L.StatusCode, CAST(L.[Percent] AS INT) AS [Percent], L.ExternalUrl, L.PublishAt
         FROM (SELECT P.Id, P.ConnectionId, P.Target, P.StatusCode, P.[Percent], P.ExternalUrl, P.PublishAt,
                      ROW_NUMBER() OVER (PARTITION BY P.ConnectionId ORDER BY P.Id DESC) AS Rn
               FROM dbo.Publications AS P
               WHERE EXISTS (SELECT 1 FROM dbo.Post_Media AS PM WHERE PM.PostId = P.PostId AND PM.MediaId = V.Id)) AS L
         INNER JOIN dbo.Social_Connections AS C ON C.Id = L.ConnectionId
         WHERE L.Rn = 1 AND L.StatusCode <> 'CANCELLED'
         ORDER BY L.Target DESC, ConnectionName
         FOR JSON PATH) AS PublicationsJson
    FROM dbo.Media_Assets AS V
    OUTER APPLY (
        SELECT COUNT(*) AS Live,
               MAX(IIF(L.StatusCode = 'DONE', 1, 0)) AS HasDone,
               MAX(IIF(L.StatusCode IN ('FAILED', 'NEEDS_RECONNECT', 'NEEDS_REVIEW'), 1, 0)) AS HasError,
               MAX(IIF(L.StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA'), 1, 0)) AS HasActive,
               MAX(IIF(L.PublishAt > @Now AND L.StatusCode <> 'FAILED', 1, 0)) AS HasScheduled,
               MAX(IIF(L.Target = @Platform, 1, 0)) AS HasPlatform
        FROM (SELECT P.StatusCode, P.Target, P.PublishAt, ROW_NUMBER() OVER (PARTITION BY P.ConnectionId ORDER BY P.Id DESC) AS Rn
              FROM dbo.Publications AS P
              WHERE EXISTS (SELECT 1 FROM dbo.Post_Media AS PM WHERE PM.PostId = P.PostId AND PM.MediaId = V.Id)) AS L
        WHERE L.Rn = 1 AND L.StatusCode <> 'CANCELLED') AS F
    WHERE V.StatusCode = 'READY'
      AND (@Id IS NULL OR V.Id = @Id)
      AND (@Kind IS NULL OR V.MediaKind = @Kind)
      AND (@SearchTerm IS NULL OR V.Title LIKE CONCAT(N'%', @SearchTerm, N'%') OR V.OriginalFileName LIKE CONCAT(N'%', @SearchTerm, N'%')
           OR EXISTS (SELECT 1 FROM dbo.Media_Tags AS T WHERE T.VideoId = V.Id AND T.Tag LIKE CONCAT(N'%', @SearchTerm, N'%')))
      AND (@Tag IS NULL OR EXISTS (SELECT 1 FROM dbo.Media_Tags AS T WHERE T.VideoId = V.Id AND T.Tag = @Tag))
      AND (@Platform IS NULL OR F.HasPlatform = 1)
      AND (@Status IS NULL
           OR (@Status = 'UNPUBLISHED' AND F.Live = 0)
           OR (@Status = 'PUBLISHED'   AND F.HasDone = 1)
           OR (@Status = 'ERROR'       AND F.HasError = 1)
           OR (@Status = 'SCHEDULED'   AND F.HasScheduled = 1)
           OR (@Status = 'ACTIVE'      AND F.HasActive = 1))
    ORDER BY
        CASE WHEN @Sort = 'TITLE' THEN V.Title END,
        CASE WHEN @Sort = 'SIZE' THEN V.SizeBytes END DESC,
        CASE WHEN @Sort = 'DURATION' THEN V.DurationSec END DESC,
        CASE WHEN @Sort = 'OLDEST' THEN V.CreatedAt END,
        V.CreatedAt DESC,
        V.Id DESC
    OFFSET COALESCE(@Offset, 0) ROWS FETCH NEXT COALESCE(@Take, 2147483647) ROWS ONLY;
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_VIDEO_GET
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, Title, OriginalFileName, StoragePath, PosterPath, ContentType, SizeBytes, DurationSec, Width, Height, MediaKind
    FROM dbo.Media_Assets
    WHERE Id = @Id AND StatusCode = 'READY';
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_VIDEO_UPDATE
    @Id          INT,
    @Title       NVARCHAR(200),
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Media_Assets
    SET Title = @Title, UpdatedBy = @UserName, UpdatedAt = @CurrentDate
    WHERE Id = @Id AND StatusCode = 'READY';

    IF @@ROWCOUNT = 0
        THROW 50002, N'El video no existe o fue eliminado.', 1;
END
GO

/* Baja lógica. Devuelve las rutas para que la API borre los archivos. */
CREATE OR ALTER PROCEDURE dbo.USP_VIDEO_DELETE
    @Id          INT,
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM dbo.Media_Assets WITH (UPDLOCK, ROWLOCK) WHERE Id = @Id AND StatusCode = 'READY')
            THROW 50002, N'El video no existe o ya fue eliminado.', 1;

        IF EXISTS (SELECT 1 FROM dbo.Publications AS P
                   INNER JOIN dbo.Post_Media AS PM ON PM.PostId = P.PostId
                   WHERE PM.MediaId = @Id AND P.StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW'))
            THROW 50003, N'El archivo forma parte de publicaciones en curso. Espera a que terminen o cancélalas antes de eliminarlo.', 1;

        UPDATE dbo.Media_Assets
        SET StatusCode = 'DELETED', UpdatedBy = @UserName, UpdatedAt = @CurrentDate
        WHERE Id = @Id;

        COMMIT TRANSACTION;

        SELECT Id, Title, OriginalFileName, StoragePath, PosterPath, ContentType, SizeBytes
        FROM dbo.Media_Assets
        WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_VIDEO_STORAGE_USED
AS
BEGIN
    SET NOCOUNT ON;

    SELECT CAST(ISNULL(SUM(SizeBytes), 0) AS BIGINT) AS UsedBytes
    FROM dbo.Media_Assets
    WHERE StatusCode = 'READY';
END
GO

/*
   Lo que se publica: tipo, nombre interno, enlace y medios en orden (@Media = JSON [{"id":1,"alt":"…"}, …]).
   Los medios deben existir y estar disponibles. Devuelve el Id del post. La API valida antes el tipo y los límites.
*/
CREATE OR ALTER PROCEDURE dbo.USP_POST_CREATE
    @Kind        VARCHAR(10),
    @Title       NVARCHAR(255),
    @LinkUrl     NVARCHAR(1000) = NULL,
    @Media       NVARCHAR(MAX)  = NULL,
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Items TABLE (Position TINYINT PRIMARY KEY, MediaId INT NOT NULL, AltText NVARCHAR(1000) NULL);
    DECLARE @Id INT;

    IF @Media IS NOT NULL AND ISJSON(@Media) = 0
        THROW 50006, N'La lista de archivos no es válida.', 1;

    INSERT INTO @Items (Position, MediaId, AltText)
    SELECT CAST(J.[key] AS TINYINT), CAST(JSON_VALUE(J.[value], '$.id') AS INT), NULLIF(LEFT(JSON_VALUE(J.[value], '$.alt'), 1000), N'')
    FROM OPENJSON(COALESCE(@Media, N'[]')) AS J;

    IF EXISTS (SELECT 1 FROM @Items AS I
               WHERE NOT EXISTS (SELECT 1 FROM dbo.Media_Assets AS M WHERE M.Id = I.MediaId AND M.StatusCode = 'READY'))
        THROW 50002, N'Uno de los archivos ya no existe o fue eliminado. Recarga la biblioteca.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO dbo.Posts (Kind, Title, LinkUrl, CreatedBy, CreatedAt)
        VALUES (@Kind, LEFT(@Title, 255), @LinkUrl, @UserName, @CurrentDate);
        SET @Id = SCOPE_IDENTITY();

        INSERT INTO dbo.Post_Media (PostId, Position, MediaId, AltText)
        SELECT @Id, Position, MediaId, AltText FROM @Items;

        COMMIT TRANSACTION;
        SELECT @Id AS Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

PRINT N'1. Biblioteca OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   2. PUBLICACIONES
   --------------------------------------------------------------------------------------------------------------------- */

/*
   Alta desde el botón Publicar: una fila por cuenta elegida, con el consentimiento (ConsentAt).
   Si la cuenta está pendiente de reconexión la fila nace en NEEDS_RECONNECT y sigue sola al reconectarla.
*/
CREATE OR ALTER PROCEDURE dbo.USP_PUBLICATION_SAVE
    @PostId                 INT,
    @VideoId                INT               = NULL,
    @ConnectionId           INT,
    @Title                  NVARCHAR(255),
    @Description            NVARCHAR(MAX)     = NULL,
    @Tags                   NVARCHAR(600)     = NULL,
    @CategoryId             VARCHAR(10)       = NULL,
    @PrivacyStatus          VARCHAR(20),
    @PublishAt              DATETIMEOFFSET(0) = NULL,
    @MadeForKids            BIT,
    @ContainsSyntheticMedia BIT,
    @NotifySubscribers      BIT,
    @Extra                  NVARCHAR(MAX)     = NULL,
    @UserName               NVARCHAR(100),
    @CurrentDate            DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Id BIGINT, @Target VARCHAR(20), @ConnectionStatus VARCHAR(20), @AccountName NVARCHAR(200), @MessageError NVARCHAR(400);

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @Target = Platform, @ConnectionStatus = StatusCode, @AccountName = COALESCE(Alias, DisplayName)
        FROM dbo.Social_Connections
        WHERE Id = @ConnectionId;

        IF @Target IS NULL OR @ConnectionStatus = 'REVOKED'
            THROW 50004, N'La cuenta de destino ya no está conectada. Recarga la página y elige otra.', 1;

        IF NOT EXISTS (SELECT 1 FROM dbo.Posts WHERE Id = @PostId)
            THROW 50002, N'La publicación no existe. Vuelve a abrir el formulario.', 1;

        IF EXISTS (SELECT 1 FROM dbo.Post_Media AS PM INNER JOIN dbo.Media_Assets AS M ON M.Id = PM.MediaId
                   WHERE PM.PostId = @PostId AND M.StatusCode <> 'READY')
            THROW 50002, N'Uno de los archivos fue eliminado. Recarga la biblioteca.', 1;

        IF EXISTS (SELECT 1 FROM dbo.Publications WITH (UPDLOCK, HOLDLOCK)
                   WHERE PostId = @PostId AND ConnectionId = @ConnectionId
                     AND StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW'))
        BEGIN
            SET @MessageError = CONCAT(N'Esta publicación ya está en curso en «', @AccountName, N'».');
            THROW 50005, @MessageError, 1;
        END

        INSERT INTO dbo.Publications
            (PostId, VideoId, ConnectionId, Target, Title, Description, Tags, CategoryId, PrivacyStatus, PublishAt, MadeForKids,
             ContainsSyntheticMedia, NotifySubscribers, Extra, ConsentAt, StatusCode, ErrorMessage, NextAttemptAt, RequestedBy, RequestedAt)
        VALUES
            (@PostId, @VideoId, @ConnectionId, @Target, @Title, @Description, @Tags, @CategoryId, @PrivacyStatus, @PublishAt, @MadeForKids,
             @ContainsSyntheticMedia, @NotifySubscribers, @Extra, @CurrentDate,
             IIF(@ConnectionStatus = 'NEEDS_RECONNECT', 'NEEDS_RECONNECT', 'PENDING'),
             IIF(@ConnectionStatus = 'NEEDS_RECONNECT', N'La cuenta necesita reconectarse; la publicación sigue al reconectarla.', NULL),
             dbo.UFN_PUBLICATION_START(@Target, @PublishAt, @CurrentDate), @UserName, @CurrentDate);

        SET @Id = SCOPE_IDENTITY();

        INSERT INTO dbo.Publication_Events (PublicationId, VideoId, Target, StatusCode, Message, IsNotification, IsRead, CreatedAt)
        SELECT Id, VideoId, Target, StatusCode,
               CONCAT(N'En cola para «', @AccountName, N'» · consentimiento registrado por ', @UserName, N'.',
                      IIF(NextAttemptAt > @CurrentDate, CONCAT(N' Sale el ', FORMAT(PublishAt, 'dd/MM/yyyy HH:mm'), N' (UTC', FORMAT(PublishAt, 'zzz'), N').'), N'')),
               0, 1, @CurrentDate
        FROM dbo.Publications
        WHERE Id = @Id;

        COMMIT TRANSACTION;

        SELECT @Id AS Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* @Group: ACTIVE, DONE, ERROR, WAITING o NULL (todas). Filtros opcionales por plataforma y por cuenta. */
CREATE OR ALTER PROCEDURE dbo.USP_PUBLICATION_LIST
    @VideoId      INT           = NULL,
    @Group        VARCHAR(20)   = NULL,
    @Platform     VARCHAR(20)   = NULL,
    @ConnectionId INT           = NULL,
    @SearchTerm   NVARCHAR(200) = NULL,
    @From         DATETIME2(3)  = NULL,
    @To           DATETIME2(3)  = NULL,
    @Top          INT           = 300,
    @CurrentDate  DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@Top)
        P.Id,
        P.VideoId,
        P.PostId,
        PO.Kind                         AS PostKind,
        (SELECT COUNT(*) FROM dbo.Post_Media AS PM WHERE PM.PostId = P.PostId) AS MediaCount,
        COALESCE(V.Title, PO.Title)     AS VideoTitle,
        P.Target,
        P.ConnectionId,
        COALESCE(C.Alias, C.DisplayName) AS ConnectionName,
        C.AvatarUrl                     AS ConnectionAvatarUrl,
        P.Title,
        P.PrivacyStatus,
        P.PublishAt,
        P.StatusCode,
        CAST(P.[Percent] AS INT)        AS [Percent],
        P.BytesSent,
        P.TotalBytes,
        P.ExternalUrl,
        P.Warning,
        P.ErrorCode,
        P.ErrorMessage,
        P.Attempts,
        P.MaxAttempts,
        P.NextAttemptAt,
        CAST(IIF(P.LeaseOwner IS NOT NULL AND P.LeaseUntil > @CurrentDate, 1, 0) AS BIT) AS IsSending,
        CAST(IIF(P.StatusCode = 'DONE' AND P.CommentExternalId IS NULL AND NULLIF(JSON_VALUE(P.Extra, '$.firstComment'), N'') IS NOT NULL, 1, 0) AS BIT) AS CommentPending,
        P.RequestedBy,
        P.RequestedAt,
        P.UpdatedAt,
        P.CompletedAt,
        M.Views,
        M.Likes,
        M.Comments
    FROM dbo.Publications AS P
    LEFT JOIN dbo.Publication_Metrics AS M ON M.PublicationId = P.Id
    INNER JOIN dbo.Posts AS PO ON PO.Id = P.PostId
    LEFT JOIN dbo.Media_Assets AS V ON V.Id = P.VideoId
    INNER JOIN dbo.Social_Connections AS C ON C.Id = P.ConnectionId
    WHERE (@VideoId IS NULL OR EXISTS (SELECT 1 FROM dbo.Post_Media AS PM WHERE PM.PostId = P.PostId AND PM.MediaId = @VideoId))
      AND (@Platform IS NULL OR P.Target = @Platform)
      AND (@ConnectionId IS NULL OR P.ConnectionId = @ConnectionId)
      AND (@SearchTerm IS NULL OR V.Title LIKE CONCAT(N'%', @SearchTerm, N'%') OR PO.Title LIKE CONCAT(N'%', @SearchTerm, N'%') OR P.Title LIKE CONCAT(N'%', @SearchTerm, N'%')
           OR C.DisplayName LIKE CONCAT(N'%', @SearchTerm, N'%') OR C.Alias LIKE CONCAT(N'%', @SearchTerm, N'%'))
      AND (@From IS NULL OR P.RequestedAt >= @From)
      AND (@To IS NULL OR P.RequestedAt < @To)
      AND (@Group IS NULL
           OR (@Group = 'ACTIVE'  AND P.StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING'))
           OR (@Group = 'DONE'    AND P.StatusCode = 'DONE')
           OR (@Group = 'ERROR'   AND P.StatusCode IN ('FAILED', 'NEEDS_RECONNECT', 'NEEDS_REVIEW'))
           OR (@Group = 'WAITING' AND P.StatusCode = 'WAITING_QUOTA'))
    ORDER BY P.Id DESC;
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_PUBLICATION_EVENT_LIST
    @VideoId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, PublicationId, Target, StatusCode, Message, CreatedAt
    FROM dbo.Publication_Events
    WHERE VideoId = @VideoId
    ORDER BY Id;
END
GO

/*
   Reintento manual desde FAILED, WAITING_QUOTA o NEEDS_RECONNECT, siempre en la MISMA cuenta para la que se dio
   el consentimiento (si se quitó y se volvió a conectar, en su conexión nueva). Si el video ya se había subido
   (ExternalId) y no falló, se retoma la consulta del estado en vez de volver a subirlo.
*/
CREATE OR ALTER PROCEDURE dbo.USP_PUBLICATION_RETRY
    @Id          BIGINT,
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @PostId INT, @Target VARCHAR(20), @StatusCode VARCHAR(20), @ConnectionId INT, @AccountExternalId NVARCHAR(100),
            @AccountName NVARCHAR(200), @NewConnectionId INT, @IsFailed BIT, @MessageError NVARCHAR(400);

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @PostId = PostId, @Target = Target, @StatusCode = StatusCode, @ConnectionId = ConnectionId
        FROM dbo.Publications WITH (UPDLOCK, ROWLOCK)
        WHERE Id = @Id;

        IF @PostId IS NULL
            THROW 50002, N'La publicación no existe. Recarga el listado.', 1;

        IF @StatusCode NOT IN ('FAILED', 'WAITING_QUOTA', 'NEEDS_RECONNECT')
            THROW 50006, N'Solo se reintenta una publicación fallida, en espera de cuota o pendiente de reconexión.', 1;

        IF EXISTS (SELECT 1 FROM dbo.Post_Media AS PM INNER JOIN dbo.Media_Assets AS M ON M.Id = PM.MediaId
                   WHERE PM.PostId = @PostId AND M.StatusCode <> 'READY')
            THROW 50002, N'Uno de los archivos de la publicación fue eliminado.', 1;

        SELECT @AccountExternalId = ExternalId, @AccountName = COALESCE(Alias, DisplayName)
        FROM dbo.Social_Connections
        WHERE Id = @ConnectionId;

        SELECT TOP (1) @NewConnectionId = Id
        FROM dbo.Social_Connections
        WHERE Platform = @Target AND ExternalId = @AccountExternalId AND StatusCode = 'CONNECTED'
        ORDER BY IIF(Id = @ConnectionId, 0, 1), Id DESC;

        IF @NewConnectionId IS NULL
        BEGIN
            SET @MessageError = CONCAT(N'La cuenta «', @AccountName, N'» no está conectada. Reconéctala en Conexiones y vuelve a intentarlo.');
            THROW 50004, @MessageError, 1;
        END

        -- Un FAILED se sube de nuevo, salvo que fallara solo por tardar en procesarse: ya está en la plataforma
        -- (ExternalId) y basta con volver a consultarlo.
        SET @IsFailed = IIF(@StatusCode = 'FAILED' AND NOT EXISTS (SELECT 1 FROM dbo.Publications
                                                                   WHERE Id = @Id AND ErrorCode = 'PROCESSING_TIMEOUT' AND ExternalId IS NOT NULL), 1, 0);

        IF @StatusCode = 'FAILED' AND EXISTS (SELECT 1 FROM dbo.Publications
                                     WHERE PostId = @PostId AND ConnectionId = @NewConnectionId AND Id <> @Id
                                       AND StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW'))
            THROW 50005, N'Esta publicación ya tiene otra en curso en esa cuenta.', 1;

        UPDATE dbo.Publications
        SET ConnectionId  = @NewConnectionId,
            CommentExternalId = IIF(@IsFailed = 1, NULL, CommentExternalId),
            StatusCode    = IIF(@IsFailed = 0 AND ExternalId IS NOT NULL, 'PROCESSING', 'PENDING'),
            ExternalId    = IIF(@IsFailed = 1, NULL, ExternalId),
            ExternalUrl   = IIF(@IsFailed = 1, NULL, ExternalUrl),
            SessionData   = IIF(@IsFailed = 1, NULL, SessionData),
            BytesSent     = IIF(@IsFailed = 1, NULL, BytesSent),
            [Percent]     = IIF(@IsFailed = 1, NULL, [Percent]),
            UploadedAt    = IIF(@IsFailed = 0 AND ExternalId IS NOT NULL, @CurrentDate, NULL),
            CommitStartedAt = NULL,
            Attempts      = 0,
            PollCount     = 0,
            NextAttemptAt = IIF(@IsFailed = 0 AND ExternalId IS NOT NULL, @CurrentDate, dbo.UFN_PUBLICATION_START(Target, PublishAt, @CurrentDate)),
            Warning       = NULL,
            ErrorCode     = NULL,
            ErrorMessage  = NULL,
            CompletedAt   = NULL,
            LeaseOwner    = NULL,
            LeaseUntil    = NULL,
            UpdatedBy     = @UserName,
            UpdatedAt     = @CurrentDate
        WHERE Id = @Id;

        INSERT INTO dbo.Publication_Events (PublicationId, VideoId, Target, StatusCode, Message, IsNotification, IsRead, CreatedAt)
        SELECT Id, VideoId, Target, StatusCode, CONCAT(N'Reintento manual por ', @UserName, N'.'), 0, 1, @CurrentDate
        FROM dbo.Publications
        WHERE Id = @Id;

        COMMIT TRANSACTION;

        SELECT 1 AS Affected, VideoId, Target, StatusCode FROM dbo.Publications WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* Solo lo que aún no está en la plataforma: en cola, en espera, o una subida cuyo lease venció. */
CREATE OR ALTER PROCEDURE dbo.USP_PUBLICATION_CANCEL
    @Id          BIGINT,
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @StatusCode VARCHAR(20), @LeaseUntil DATETIME2(3), @Found BIT = 0;

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @Found = 1, @StatusCode = StatusCode, @LeaseUntil = LeaseUntil
        FROM dbo.Publications WITH (UPDLOCK, ROWLOCK)
        WHERE Id = @Id;

        IF @Found = 0
            THROW 50002, N'La publicación no existe. Recarga el listado.', 1;

        IF NOT (@StatusCode IN ('PENDING', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW')
                OR (@StatusCode = 'UPLOADING' AND (@LeaseUntil IS NULL OR @LeaseUntil < @CurrentDate)))
            THROW 50008, N'No se puede cancelar: la subida está en curso o el video ya está en la plataforma.', 1;

        UPDATE dbo.Publications
        SET StatusCode = 'CANCELLED', SessionData = NULL, LeaseOwner = NULL, LeaseUntil = NULL,
            CompletedAt = @CurrentDate, UpdatedBy = @UserName, UpdatedAt = @CurrentDate
        WHERE Id = @Id;

        INSERT INTO dbo.Publication_Events (PublicationId, VideoId, Target, StatusCode, Message, IsNotification, IsRead, CreatedAt)
        SELECT Id, VideoId, Target, 'CANCELLED', CONCAT(N'Cancelada por ', @UserName, N'.'), 0, 1, @CurrentDate
        FROM dbo.Publications
        WHERE Id = @Id;

        COMMIT TRANSACTION;

        SELECT 1 AS Affected, VideoId, Target, StatusCode FROM dbo.Publications WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/*
   Resuelve a mano una publicación en revisión (NEEDS_REVIEW) o fallida:
     MARK_DONE  la persona comprobó que ya está en la plataforma (opcional: su enlace). Solo desde NEEDS_REVIEW.
     REUPLOAD   se sube de nuevo desde cero (sesión, id externo y marca del paso irreversible a cero).
*/
CREATE OR ALTER PROCEDURE dbo.USP_PUBLICATION_RESOLVE
    @Id          BIGINT,
    @Action      VARCHAR(20),
    @ExternalUrl NVARCHAR(500) = NULL,
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @StatusCode VARCHAR(20), @PostId INT, @ConnectionId INT, @Found BIT = 0;

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @Found = 1, @StatusCode = StatusCode, @PostId = PostId, @ConnectionId = ConnectionId
        FROM dbo.Publications WITH (UPDLOCK, ROWLOCK)
        WHERE Id = @Id;

        IF @Found = 0
            THROW 50002, N'La publicación no existe. Recarga el listado.', 1;

        IF @Action NOT IN ('MARK_DONE', 'REUPLOAD')
            THROW 50006, N'Acción no válida.', 1;

        IF @Action = 'MARK_DONE' AND @StatusCode <> 'NEEDS_REVIEW'
            THROW 50006, N'Solo se marca como publicada una publicación pendiente de revisión.', 1;

        IF @Action = 'REUPLOAD' AND @StatusCode NOT IN ('NEEDS_REVIEW', 'FAILED')
            THROW 50006, N'Solo se vuelve a subir una publicación fallida o pendiente de revisión.', 1;

        IF @Action = 'REUPLOAD' AND EXISTS (SELECT 1 FROM dbo.Post_Media AS PM INNER JOIN dbo.Media_Assets AS M ON M.Id = PM.MediaId
                                            WHERE PM.PostId = @PostId AND M.StatusCode <> 'READY')
            THROW 50002, N'Uno de los archivos de la publicación fue eliminado.', 1;

        IF @Action = 'REUPLOAD' AND @StatusCode = 'FAILED' AND EXISTS (SELECT 1 FROM dbo.Publications
                                     WHERE PostId = @PostId AND ConnectionId = @ConnectionId AND Id <> @Id
                                       AND StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW'))
            THROW 50005, N'Esta publicación ya tiene otra en curso en esa cuenta.', 1;

        IF @Action = 'MARK_DONE'
            UPDATE dbo.Publications
            SET StatusCode = 'DONE', ExternalUrl = COALESCE(@ExternalUrl, ExternalUrl), [Percent] = 100,
                SessionData = NULL, CommitStartedAt = NULL, ErrorCode = NULL, ErrorMessage = NULL,
                Warning = N'Marcada como publicada a mano.', CompletedAt = @CurrentDate,
                LeaseOwner = NULL, LeaseUntil = NULL, UpdatedBy = @UserName, UpdatedAt = @CurrentDate
            WHERE Id = @Id;
        ELSE
            UPDATE dbo.Publications
            SET StatusCode = 'PENDING', ExternalId = NULL, ExternalUrl = NULL, CommentExternalId = NULL, SessionData = NULL, CommitStartedAt = NULL,
                BytesSent = NULL, [Percent] = NULL, UploadedAt = NULL, Attempts = 0, PollCount = 0,
                NextAttemptAt = dbo.UFN_PUBLICATION_START(Target, PublishAt, @CurrentDate),
                Warning = NULL, ErrorCode = NULL, ErrorMessage = NULL, CompletedAt = NULL,
                LeaseOwner = NULL, LeaseUntil = NULL, UpdatedBy = @UserName, UpdatedAt = @CurrentDate
            WHERE Id = @Id;

        INSERT INTO dbo.Publication_Events (PublicationId, VideoId, Target, StatusCode, Message, IsNotification, IsRead, CreatedAt)
        SELECT Id, VideoId, Target, StatusCode,
               IIF(@Action = 'MARK_DONE', CONCAT(N'Marcada como publicada por ', @UserName, N'.'),
                                          CONCAT(N'Se vuelve a subir desde cero (', @UserName, N').')),
               0, 1, @CurrentDate
        FROM dbo.Publications
        WHERE Id = @Id;

        COMMIT TRANSACTION;

        SELECT 1 AS Affected, VideoId, Target, StatusCode FROM dbo.Publications WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* Datos para volver a poner el primer comentario a mano (botón «Reintentar comentario»). */
CREATE OR ALTER PROCEDURE dbo.USP_PUBLICATION_COMMENT_GET
    @Id BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT P.Id, P.VideoId, P.Target, P.StatusCode, P.ExternalId, P.Extra, P.CommentExternalId,
           P.ConnectionId, C.ConnectionKey, C.CredentialId, C.ExternalId AS AccountExternalId, C.StatusCode AS ConnectionStatus
    FROM dbo.Publications AS P
    INNER JOIN dbo.Social_Connections AS C ON C.Id = P.ConnectionId
    WHERE P.Id = @Id;
END
GO

/* Resultado del reintento del primer comentario: con id = puesto (se quita el aviso); sin id = sigue el aviso. */
CREATE OR ALTER PROCEDURE dbo.USP_PUBLICATION_COMMENT_SAVE
    @Id                BIGINT,
    @CommentExternalId NVARCHAR(200) = NULL,
    @Message           NVARCHAR(500),
    @CurrentDate       DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.Publications
        SET CommentExternalId = COALESCE(@CommentExternalId, CommentExternalId),
            Warning = IIF(@CommentExternalId IS NULL, LEFT(@Message, 500), NULL),
            UpdatedAt = @CurrentDate
        WHERE Id = @Id AND StatusCode = 'DONE';

        IF @@ROWCOUNT = 0
            THROW 50006, N'Solo se pone el comentario en una publicación ya publicada.', 1;

        INSERT INTO dbo.Publication_Events (PublicationId, VideoId, Target, StatusCode, Message, IsNotification, IsRead, CreatedAt)
        SELECT Id, VideoId, Target, StatusCode, LEFT(@Message, 500), 0, 1, @CurrentDate
        FROM dbo.Publications
        WHERE Id = @Id;

        COMMIT TRANSACTION;

        SELECT 1 AS Affected, VideoId, Target, StatusCode FROM dbo.Publications WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

PRINT N'2. Publicaciones OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   3. JOB (COLA CON LEASE)
   --------------------------------------------------------------------------------------------------------------------- */

/*
   Reserva hasta @Top filas listas para subir: en cola, en espera de cuota vencida o una subida cuyo lease venció
   (proceso caído: se retoma con la sesión guardada). Cada reserva cuenta como un intento, salvo retomar tras
   esperar cuota (esperar no es fallar). El job reserva de una en una (@Top = 1) para que ninguna fila espere con
   el lease corriendo.
*/
CREATE OR ALTER PROCEDURE dbo.USP_BG_PUBLICATION_DUE_LIST
    @Target       VARCHAR(20),
    @Top          INT,
    @LeaseOwner   VARCHAR(100),
    @LeaseMinutes INT,
    @CurrentDate  DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Taken TABLE (Id BIGINT PRIMARY KEY, PreviousStatus VARCHAR(20) NOT NULL);

    BEGIN TRY
        BEGIN TRANSACTION;

        WITH Due AS
        (
            SELECT TOP (@Top) P.Id, P.StatusCode, P.LeaseOwner, P.LeaseUntil, P.Attempts, P.LastProgressAt, P.UpdatedAt
            FROM dbo.Publications AS P WITH (UPDLOCK, READPAST, ROWLOCK)
            WHERE P.Target = @Target
              AND P.StatusCode IN ('PENDING', 'UPLOADING', 'WAITING_QUOTA')
              AND (P.NextAttemptAt IS NULL OR P.NextAttemptAt <= @CurrentDate)
              AND (P.LeaseUntil IS NULL OR P.LeaseUntil < @CurrentDate)
            ORDER BY P.NextAttemptAt, P.Id
        )
        UPDATE Due
        SET StatusCode     = 'UPLOADING',
            LeaseOwner     = @LeaseOwner,
            LeaseUntil     = DATEADD(MINUTE, @LeaseMinutes, @CurrentDate),
            Attempts       = Attempts + IIF(StatusCode = 'WAITING_QUOTA', 0, 1),
            LastProgressAt = @CurrentDate,
            UpdatedAt      = @CurrentDate
        OUTPUT inserted.Id, deleted.StatusCode INTO @Taken (Id, PreviousStatus);

        INSERT INTO dbo.Publication_Events (PublicationId, VideoId, Target, StatusCode, Message, IsNotification, IsRead, CreatedAt)
        SELECT P.Id, P.VideoId, P.Target, 'UPLOADING',
               IIF(T.PreviousStatus = 'UPLOADING', N'Se retoma la subida interrumpida.',
                   CONCAT(N'Subiendo a ', dbo.UFN_PLATFORM_LABEL(P.Target), N' (intento ', P.Attempts, N').')),
               0, 1, @CurrentDate
        FROM @Taken AS T
        INNER JOIN dbo.Publications AS P ON P.Id = T.Id;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH

    SELECT
        P.Id,
        P.VideoId,
        P.Target,
        P.ConnectionId,
        C.ConnectionKey,
        C.CredentialId,
        C.ExternalId AS AccountExternalId,
        C.StatusCode AS ConnectionStatus,
        C.DisplayName AS AccountName,
        P.Title,
        P.Description,
        P.Tags,
        P.CategoryId,
        P.PrivacyStatus,
        P.PublishAt,
        P.MadeForKids,
        P.ContainsSyntheticMedia,
        P.NotifySubscribers,
        P.Extra,
        P.SessionData,
        P.CommitStartedAt,
        P.Attempts,
        P.MaxAttempts,
        P.PostId,
        PO.Kind AS PostKind,
        PO.LinkUrl,
        (SELECT M.Id, M.StoragePath, M.ContentType, M.SizeBytes, M.MediaKind, M.Width, M.Height, M.DurationSec, PM.AltText
         FROM dbo.Post_Media AS PM
         INNER JOIN dbo.Media_Assets AS M ON M.Id = PM.MediaId
         WHERE PM.PostId = P.PostId
         ORDER BY PM.Position
         FOR JSON PATH) AS MediaJson,
        V.StoragePath,
        V.PosterPath,
        V.ContentType,
        V.SizeBytes,
        V.DurationSec,
        V.Width,
        V.Height
    FROM @Taken AS T
    INNER JOIN dbo.Publications AS P ON P.Id = T.Id
    INNER JOIN dbo.Posts AS PO ON PO.Id = P.PostId
    LEFT JOIN dbo.Media_Assets AS V ON V.Id = P.VideoId
    INNER JOIN dbo.Social_Connections AS C ON C.Id = P.ConnectionId
    ORDER BY P.Id;
END
GO

/* Reserva filas ya subidas (PROCESSING) cuya próxima consulta de estado venció. */
CREATE OR ALTER PROCEDURE dbo.USP_BG_PUBLICATION_POLL_DUE_LIST
    @Top          INT,
    @LeaseOwner   VARCHAR(100),
    @LeaseMinutes INT,
    @CurrentDate  DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Taken TABLE (Id BIGINT PRIMARY KEY);

    WITH Due AS
    (
        SELECT TOP (@Top) P.Id, P.LeaseOwner, P.LeaseUntil
        FROM dbo.Publications AS P WITH (UPDLOCK, READPAST, ROWLOCK)
        WHERE P.StatusCode = 'PROCESSING'
          AND (P.NextAttemptAt IS NULL OR P.NextAttemptAt <= @CurrentDate)
          AND (P.LeaseUntil IS NULL OR P.LeaseUntil < @CurrentDate)
        ORDER BY P.NextAttemptAt, P.Id
    )
    UPDATE Due
    SET LeaseOwner = @LeaseOwner,
        LeaseUntil = DATEADD(MINUTE, @LeaseMinutes, @CurrentDate)
    OUTPUT inserted.Id INTO @Taken (Id);

    SELECT
        P.Id,
        P.VideoId,
        P.Target,
        P.ConnectionId,
        C.ConnectionKey,
        C.CredentialId,
        C.ExternalId AS AccountExternalId,
        C.StatusCode AS ConnectionStatus,
        P.ExternalId,
        P.ExternalUrl,
        P.Title,
        P.Description,
        P.PrivacyStatus,
        P.PublishAt,
        P.Extra,
        P.SessionData,
        P.PollCount,
        P.UploadedAt,
        P.Attempts,
        P.MaxAttempts,
        P.PostId,
        PO.Kind AS PostKind,
        PO.LinkUrl,
        (SELECT M.Id, M.StoragePath, M.ContentType, M.SizeBytes, M.MediaKind, M.Width, M.Height, M.DurationSec, PM.AltText
         FROM dbo.Post_Media AS PM
         INNER JOIN dbo.Media_Assets AS M ON M.Id = PM.MediaId
         WHERE PM.PostId = P.PostId
         ORDER BY PM.Position
         FOR JSON PATH) AS MediaJson
    FROM @Taken AS T
    INNER JOIN dbo.Publications AS P ON P.Id = T.Id
    INNER JOIN dbo.Posts AS PO ON PO.Id = P.PostId
    INNER JOIN dbo.Social_Connections AS C ON C.Id = P.ConnectionId
    ORDER BY P.Id;
END
GO

/* Latido de una subida larga. 0 filas = otro proceso tomó la publicación: el job corta la subida. */
CREATE OR ALTER PROCEDURE dbo.USP_BG_PUBLICATION_LEASE_EXTEND
    @Id           BIGINT,
    @LeaseOwner   VARCHAR(100),
    @LeaseMinutes INT,
    @BytesSent    BIGINT,
    @TotalBytes   BIGINT,
    @Percent      INT,
    @CurrentDate  DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Publications
    SET LeaseUntil     = DATEADD(MINUTE, @LeaseMinutes, @CurrentDate),
        BytesSent      = @BytesSent,
        TotalBytes     = @TotalBytes,
        [Percent]      = CAST(CASE WHEN @Percent < 0 THEN 0 WHEN @Percent > 100 THEN 100 ELSE @Percent END AS TINYINT),
        LastProgressAt = @CurrentDate
    WHERE Id = @Id AND LeaseOwner = @LeaseOwner AND StatusCode = 'UPLOADING';

    SELECT @@ROWCOUNT AS Affected;
END
GO

/*
   Marca el inicio del paso irreversible (la plataforma puede publicar desde aquí). Si el proceso muere antes de
   cerrar el intento, la siguiente vuelta ve la marca y comprueba en la plataforma antes de subir otra vez.
*/
CREATE OR ALTER PROCEDURE dbo.USP_BG_PUBLICATION_COMMIT_MARK
    @Id          BIGINT,
    @LeaseOwner  VARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Publications
    SET CommitStartedAt = @CurrentDate, LastProgressAt = @CurrentDate
    WHERE Id = @Id AND LeaseOwner = @LeaseOwner AND StatusCode = 'UPLOADING';

    SELECT @@ROWCOUNT AS Affected;
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_BG_PUBLICATION_SESSION_SAVE
    @Id          BIGINT,
    @LeaseOwner  VARCHAR(100),
    @SessionData NVARCHAR(MAX) = NULL,
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Publications
    SET SessionData = @SessionData, LastProgressAt = @CurrentDate
    WHERE Id = @Id AND LeaseOwner = @LeaseOwner;

    SELECT @@ROWCOUNT AS Affected;
END
GO

/* Cierra un intento (subida o consulta): libera el lease, guarda el estado y, si corresponde, el evento/aviso. */
CREATE OR ALTER PROCEDURE dbo.USP_BG_PUBLICATION_RESULT
    @Id             BIGINT,
    @LeaseOwner     VARCHAR(100),
    @StatusCode     VARCHAR(20),
    @ExternalId     NVARCHAR(100) = NULL,
    @ExternalUrl    NVARCHAR(500) = NULL,
    @CommentExternalId NVARCHAR(200) = NULL,
    @Warning        NVARCHAR(500) = NULL,
    @ErrorCode      VARCHAR(100)  = NULL,
    @ErrorMessage   NVARCHAR(500) = NULL,
    @NextAttemptAt  DATETIME2(3)  = NULL,
    @ClearSession   BIT           = 0,
    @ClearExternal  BIT           = 0,
    @IsPoll         BIT           = 0,
    @EventMessage   NVARCHAR(500) = NULL,
    @IsNotification BIT           = 0,
    @CurrentDate    DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Affected INT;

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.Publications
        SET StatusCode    = @StatusCode,
            ExternalId    = IIF(@ClearExternal = 1, NULL, COALESCE(@ExternalId, ExternalId)),
            ExternalUrl   = IIF(@ClearExternal = 1, NULL, COALESCE(@ExternalUrl, ExternalUrl)),
            CommentExternalId = IIF(@ClearExternal = 1, NULL, COALESCE(@CommentExternalId, CommentExternalId)),
            Warning       = COALESCE(LEFT(@Warning, 500), Warning),
            ErrorCode     = LEFT(@ErrorCode, 100),
            ErrorMessage  = LEFT(@ErrorMessage, 500),
            NextAttemptAt = @NextAttemptAt,
            SessionData   = IIF(@ClearSession = 1, NULL, SessionData),
            CommitStartedAt = NULL,
            PollCount     = CASE WHEN @ClearExternal = 1 THEN 0 WHEN @IsPoll = 1 THEN PollCount + 1 WHEN @StatusCode = 'PROCESSING' THEN 0 ELSE PollCount END,
            UploadedAt    = CASE WHEN @ClearExternal = 1 THEN NULL WHEN @StatusCode = 'PROCESSING' AND @IsPoll = 0 THEN @CurrentDate ELSE UploadedAt END,
            [Percent]     = CASE WHEN @ClearExternal = 1 THEN NULL WHEN @StatusCode IN ('PROCESSING', 'DONE') THEN 100 ELSE [Percent] END,
            CompletedAt   = IIF(@StatusCode IN ('DONE', 'FAILED'), @CurrentDate, CompletedAt),
            LeaseOwner    = NULL,
            LeaseUntil    = NULL,
            UpdatedAt     = @CurrentDate
        WHERE Id = @Id AND LeaseOwner = @LeaseOwner;

        SET @Affected = @@ROWCOUNT;

        IF @Affected = 1 AND @EventMessage IS NOT NULL
            INSERT INTO dbo.Publication_Events (PublicationId, VideoId, Target, StatusCode, Message, IsNotification, IsRead, CreatedAt)
            SELECT Id, VideoId, Target, @StatusCode, LEFT(@EventMessage, 500), @IsNotification, IIF(@IsNotification = 1, 0, 1), @CurrentDate
            FROM dbo.Publications
            WHERE Id = @Id;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH

    SELECT @Affected AS Affected, VideoId, Target, StatusCode
    FROM dbo.Publications
    WHERE Id = @Id;
END
GO

/*
   Retención del historial: borra eventos anteriores a @Before de publicaciones ya cerradas (DONE, FAILED,
   CANCELLED). Nunca borra avisos sin leer ni el último evento de cada publicación. Por lotes para no bloquear.
*/
CREATE OR ALTER PROCEDURE dbo.USP_BG_EVENT_PURGE
    @Before DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Total INT = 0, @Batch INT = 1;

    WHILE @Batch > 0
    BEGIN
        DELETE TOP (2000) E
        FROM dbo.Publication_Events AS E
        INNER JOIN dbo.Publications AS P ON P.Id = E.PublicationId
        WHERE E.CreatedAt < @Before
          AND P.StatusCode IN ('DONE', 'FAILED', 'CANCELLED')
          AND NOT (E.IsNotification = 1 AND E.IsRead = 0)
          AND E.Id < (SELECT MAX(L.Id) FROM dbo.Publication_Events AS L WHERE L.PublicationId = E.PublicationId);

        SET @Batch = @@ROWCOUNT;
        SET @Total += @Batch;
    END

    SELECT @Total AS Purged;
END
GO

PRINT N'3. Cola del job OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   4. CONEXIONES
   --------------------------------------------------------------------------------------------------------------------- */

/* Cuentas activas (todas) + las 10 últimas retiradas de cada plataforma (historial). Nunca devuelve el secreto. */
CREATE OR ALTER PROCEDURE dbo.USP_CONNECTION_LIST
AS
BEGIN
    SET NOCOUNT ON;

    SELECT X.Id, X.Platform, X.ExternalId, X.DisplayName, X.Alias, X.AvatarUrl, X.AccountHint, X.Scopes, X.TokenExpiresAt,
           X.StatusCode, X.StatusMessage, X.IsDefault, X.CredentialId, Cr.Name AS CredentialName,
           TRY_CAST(JSON_VALUE(Cr.Settings, '$.maxUploadMb') AS INT) AS UploadLimitMb,
           X.ConnectedBy, X.ConnectedAt, X.LastUsedAt, X.LastTestAt, X.LastTestOk, X.LastTestMessage, X.RevokedAt, X.Signature
    FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY Platform, IIF(StatusCode = 'REVOKED', 1, 0)
                                       ORDER BY RevokedAt DESC, ConnectedAt DESC, Id DESC) AS Rn
          FROM dbo.Social_Connections) AS X
    LEFT JOIN dbo.Platform_Credentials AS Cr ON Cr.Id = X.CredentialId
    WHERE X.StatusCode <> 'REVOKED' OR X.Rn <= 10
    ORDER BY CASE X.Platform WHEN 'YOUTUBE' THEN 1 WHEN 'FACEBOOK' THEN 2 WHEN 'INSTAGRAM' THEN 3 WHEN 'TELEGRAM' THEN 4
                             WHEN 'WHATSAPP' THEN 9 ELSE 5 END,
             IIF(X.StatusCode = 'REVOKED', 1, 0), X.IsDefault DESC, COALESCE(X.Alias, X.DisplayName), X.Id;
END
GO

/* Por @Id, o la predeterminada de @Platform. Incluye el secreto: uso interno de la API. */
CREATE OR ALTER PROCEDURE dbo.USP_CONNECTION_GET
    @Id       INT         = NULL,
    @Platform VARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1) Id, Platform, ConnectionKey, ExternalId, DisplayName, StatusCode, SecretCipher, CredentialId, Scopes, Extra
    FROM dbo.Social_Connections
    WHERE (@Id IS NOT NULL AND Id = @Id)
       OR (@Id IS NULL AND Platform = @Platform AND IsDefault = 1);
END
GO

/* Cuentas conectadas (con secreto) para la prueba periódica del job. */
CREATE OR ALTER PROCEDURE dbo.USP_CONNECTION_ACTIVE_LIST
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, Platform, ConnectionKey, ExternalId, DisplayName, StatusCode, SecretCipher, CredentialId, LastTestAt, Scopes, Extra
    FROM dbo.Social_Connections
    WHERE StatusCode = 'CONNECTED'
    ORDER BY Platform, Id;
END
GO

/*
   Conecta una cuenta. Si ya estaba conectada (misma plataforma y ExternalId) se actualiza su fila: es una
   reconexión y lo que esperaba reconexión sigue solo. Si es nueva se añade; queda como predeterminada solo
   si su plataforma aún no tenía ninguna.
*/
CREATE OR ALTER PROCEDURE dbo.USP_CONNECTION_SAVE
    @Platform       VARCHAR(20),
    @ConnectionKey  VARCHAR(50),
    @ExternalId     NVARCHAR(100),
    @DisplayName    NVARCHAR(200),
    @AvatarUrl      NVARCHAR(1000) = NULL,
    @AccountHint    NVARCHAR(200)  = NULL,
    @Scopes         NVARCHAR(1000) = NULL,
    @TokenExpiresAt DATETIME2(3)   = NULL,
    @SecretCipher   NVARCHAR(MAX)  = NULL,
    @CredentialId   INT            = NULL,
    @Extra          NVARCHAR(MAX)  = NULL,
    @UserName       NVARCHAR(100),
    @CurrentDate    DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Id INT, @IsNew BIT = 0;
    DECLARE @Moved TABLE (Id BIGINT, VideoId INT, Target VARCHAR(20), NewStatus VARCHAR(20));

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @Id = Id
        FROM dbo.Social_Connections WITH (UPDLOCK, HOLDLOCK)
        WHERE Platform = @Platform AND ExternalId = @ExternalId AND StatusCode IN ('CONNECTED', 'NEEDS_RECONNECT');

        IF @Id IS NOT NULL
        BEGIN
            UPDATE dbo.Social_Connections
            SET DisplayName    = @DisplayName,
                AvatarUrl      = @AvatarUrl,
                AccountHint    = @AccountHint,
                Scopes         = @Scopes,
                TokenExpiresAt = @TokenExpiresAt,
                SecretCipher   = @SecretCipher,
                CredentialId   = @CredentialId,
                Extra          = @Extra,
                StatusCode     = 'CONNECTED',
                StatusMessage  = NULL,
                ConnectedBy    = @UserName,
                ConnectedAt    = @CurrentDate,
                LastUsedAt     = @CurrentDate
            WHERE Id = @Id;

            -- Lo que esperaba la reconexión continúa con el token nuevo.
            UPDATE dbo.Publications
            SET StatusCode    = IIF(ExternalId IS NULL, 'PENDING', 'PROCESSING'),
                NextAttemptAt = IIF(ExternalId IS NULL, dbo.UFN_PUBLICATION_START(Target, PublishAt, @CurrentDate), @CurrentDate),
                -- El plazo de procesamiento cuenta desde ahora: lo esperado sin cuenta no cuenta como «tardar».
                UploadedAt    = IIF(ExternalId IS NULL, UploadedAt, @CurrentDate),
                PollCount     = 0,
                ErrorCode     = NULL,
                ErrorMessage  = NULL,
                UpdatedAt     = @CurrentDate
            OUTPUT inserted.Id, inserted.VideoId, inserted.Target, inserted.StatusCode INTO @Moved
            WHERE ConnectionId = @Id AND StatusCode = 'NEEDS_RECONNECT';

            INSERT INTO dbo.Publication_Events (PublicationId, VideoId, Target, StatusCode, Message, IsNotification, IsRead, CreatedAt)
            SELECT Id, VideoId, Target, NewStatus, N'Cuenta reconectada: la publicación continúa.', 0, 1, @CurrentDate
            FROM @Moved;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.Social_Connections
                (Platform, ConnectionKey, ExternalId, DisplayName, AvatarUrl, AccountHint, Scopes, TokenExpiresAt, SecretCipher,
                 CredentialId, Extra, StatusCode, IsDefault, ConnectedBy, ConnectedAt, LastUsedAt)
            VALUES
                (@Platform, @ConnectionKey, @ExternalId, @DisplayName, @AvatarUrl, @AccountHint, @Scopes, @TokenExpiresAt, @SecretCipher,
                 @CredentialId, @Extra, 'CONNECTED',
                 IIF(EXISTS (SELECT 1 FROM dbo.Social_Connections WHERE Platform = @Platform AND IsDefault = 1), 0, 1),
                 @UserName, @CurrentDate, @CurrentDate);

            SET @Id = SCOPE_IDENTITY();
            SET @IsNew = 1;
        END

        COMMIT TRANSACTION;

        SELECT @Id AS Id, @IsNew AS IsNew;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_CONNECTION_DEFAULT_SET
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Platform VARCHAR(20);

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @Platform = Platform
        FROM dbo.Social_Connections WITH (UPDLOCK, ROWLOCK)
        WHERE Id = @Id AND StatusCode IN ('CONNECTED', 'NEEDS_RECONNECT');

        IF @Platform IS NULL
            THROW 50002, N'La cuenta no existe o ya no está conectada. Recarga la página.', 1;

        UPDATE dbo.Social_Connections SET IsDefault = 0 WHERE Platform = @Platform AND IsDefault = 1 AND Id <> @Id;
        UPDATE dbo.Social_Connections SET IsDefault = 1 WHERE Id = @Id;

        COMMIT TRANSACTION;

        SELECT @Platform AS Platform;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* Nombre corto que se muestra en la app. Vacío = el nombre de la plataforma. */
CREATE OR ALTER PROCEDURE dbo.USP_CONNECTION_ALIAS_SAVE
    @Id    INT,
    @Alias NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Social_Connections
    SET Alias = NULLIF(LTRIM(RTRIM(@Alias)), N'')
    WHERE Id = @Id AND StatusCode <> 'REVOKED';

    IF @@ROWCOUNT = 0
        THROW 50002, N'La cuenta no existe o ya no está conectada. Recarga la página.', 1;

    SELECT Platform FROM dbo.Social_Connections WHERE Id = @Id;
END
GO

/*
   Quitar una cuenta: cancela SOLO lo que esperaba en esa cuenta y borra su token. Si era la predeterminada,
   pasa a serlo otra de la misma plataforma. Devuelve el secreto para revocarlo en Google o TikTok.
*/
CREATE OR ALTER PROCEDURE dbo.USP_CONNECTION_DELETE
    @Id          INT,
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Platform VARCHAR(20), @SecretCipher NVARCHAR(MAX), @StatusCode VARCHAR(20), @WasDefault BIT, @CredentialId INT;
    DECLARE @Cancelled TABLE (Id BIGINT, VideoId INT, Target VARCHAR(20));

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @Platform = Platform, @SecretCipher = SecretCipher, @StatusCode = StatusCode, @WasDefault = IsDefault, @CredentialId = CredentialId
        FROM dbo.Social_Connections WITH (UPDLOCK, ROWLOCK)
        WHERE Id = @Id;

        IF @Platform IS NULL
            THROW 50002, N'La conexión no existe. Recarga la página.', 1;

        IF @StatusCode = 'REVOKED'
            THROW 50011, N'La conexión ya estaba desconectada.', 1;

        IF EXISTS (SELECT 1 FROM dbo.Publications
                   WHERE ConnectionId = @Id
                     AND (StatusCode = 'PROCESSING' OR (StatusCode = 'UPLOADING' AND LeaseUntil > @CurrentDate)))
            THROW 50010, N'Hay publicaciones subiéndose o procesándose con esta cuenta. Espera a que terminen antes de quitarla.', 1;

        UPDATE dbo.Publications
        SET StatusCode = 'CANCELLED', SessionData = NULL, LeaseOwner = NULL, LeaseUntil = NULL,
            ErrorMessage = N'Se quitó la cuenta.', CompletedAt = @CurrentDate, UpdatedBy = @UserName, UpdatedAt = @CurrentDate
        OUTPUT inserted.Id, inserted.VideoId, inserted.Target INTO @Cancelled
        WHERE ConnectionId = @Id
          AND StatusCode IN ('PENDING', 'UPLOADING', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW');

        INSERT INTO dbo.Publication_Events (PublicationId, VideoId, Target, StatusCode, Message, IsNotification, IsRead, CreatedAt)
        SELECT Id, VideoId, Target, 'CANCELLED', N'Cancelada: se quitó la cuenta.', 1, 0, @CurrentDate
        FROM @Cancelled;

        UPDATE dbo.Social_Connections
        SET IsDefault = 0, StatusCode = 'REVOKED', SecretCipher = NULL, RevokedAt = @CurrentDate,
            StatusMessage = CONCAT(N'Quitada por ', @UserName, N'.')
        WHERE Id = @Id;

        IF @WasDefault = 1
            UPDATE dbo.Social_Connections
            SET IsDefault = 1
            WHERE Id = (SELECT TOP (1) Id
                        FROM dbo.Social_Connections
                        WHERE Platform = @Platform AND StatusCode IN ('CONNECTED', 'NEEDS_RECONNECT')
                        ORDER BY IIF(StatusCode = 'CONNECTED', 0, 1), ConnectedAt DESC, Id DESC);

        COMMIT TRANSACTION;

        SELECT @Platform AS Platform, @SecretCipher AS SecretCipher, @CredentialId AS CredentialId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_CONNECTION_TEST_SAVE
    @Id          INT,
    @IsOk        BIT,
    @Message     NVARCHAR(500),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Social_Connections
    SET LastTestAt = @CurrentDate,
        LastTestOk = @IsOk,
        LastTestMessage = LEFT(@Message, 500),
        LastUsedAt = IIF(@IsOk = 1, @CurrentDate, LastUsedAt)
    WHERE Id = @Id;
END
GO

/* IDataStore de Google (DbTokenDataStore). */
CREATE OR ALTER PROCEDURE dbo.USP_CONNECTION_TOKEN_GET
    @ConnectionKey VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT SecretCipher
    FROM dbo.Social_Connections
    WHERE ConnectionKey = @ConnectionKey AND StatusCode = 'CONNECTED';
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_CONNECTION_TOKEN_SAVE
    @ConnectionKey VARCHAR(50),
    @SecretCipher  NVARCHAR(MAX),
    @CurrentDate   DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Social_Connections
    SET SecretCipher = @SecretCipher, LastUsedAt = @CurrentDate
    WHERE ConnectionKey = @ConnectionKey AND StatusCode = 'CONNECTED';
END
GO

/* La librería de Google "borra" el token ante cualquier 4xx al refrescar: aquí queda como pendiente de reconexión. */
CREATE OR ALTER PROCEDURE dbo.USP_CONNECTION_MARK_RECONNECT
    @ConnectionKey VARCHAR(50),
    @Message       NVARCHAR(500),
    @CurrentDate   DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Social_Connections
    SET StatusCode = 'NEEDS_RECONNECT', SecretCipher = NULL, StatusMessage = LEFT(@Message, 500),
        LastTestAt = @CurrentDate, LastTestOk = 0, LastTestMessage = LEFT(@Message, 500)
    WHERE ConnectionKey = @ConnectionKey AND StatusCode = 'CONNECTED';
END
GO

PRINT N'4. Conexiones OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   5. CLAVES DE PLATAFORMA (Google, TikTok, bots de Telegram)
   --------------------------------------------------------------------------------------------------------------------- */

/* Sin el secreto. InUse = cuentas activas que dependen de esta clave. */
CREATE OR ALTER PROCEDURE dbo.USP_CREDENTIAL_LIST
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Cr.Id, Cr.Platform, Cr.Name, Cr.PublicId, Cr.Settings,
           (SELECT COUNT(*) FROM dbo.Social_Connections AS C WHERE C.CredentialId = Cr.Id AND C.StatusCode <> 'REVOKED') AS InUse,
           Cr.CreatedBy, Cr.CreatedAt, Cr.UpdatedBy, Cr.UpdatedAt
    FROM dbo.Platform_Credentials AS Cr
    WHERE Cr.StatusCode = 'ACTIVE'
    ORDER BY Cr.Platform, Cr.Name;
END
GO

/* Por @Id, o la única activa de @Platform (Google, TikTok). Incluye el secreto: uso interno de la API. */
CREATE OR ALTER PROCEDURE dbo.USP_CREDENTIAL_GET
    @Id       INT         = NULL,
    @Platform VARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1) Id, Platform, Name, PublicId, SecretCipher, Settings
    FROM dbo.Platform_Credentials
    WHERE StatusCode = 'ACTIVE'
      AND ((@Id IS NOT NULL AND Id = @Id) OR (@Id IS NULL AND Platform = @Platform))
    ORDER BY Id DESC;
END
GO

/*
   Alta o cambio. Google, TikTok y cada app de LinkedIn tienen una sola clave activa (se sobrescribe); un bot de Telegram se identifica
   por su id. @SecretCipher NULL al editar = conservar el secreto guardado.
*/
CREATE OR ALTER PROCEDURE dbo.USP_CREDENTIAL_SAVE
    @Id           INT           = NULL,
    @Platform     VARCHAR(20),
    @Name         NVARCHAR(100),
    @PublicId     NVARCHAR(300) = NULL,
    @SecretCipher NVARCHAR(MAX) = NULL,
    @Settings     NVARCHAR(MAX) = NULL,
    @UserName     NVARCHAR(100),
    @CurrentDate  DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF @Id IS NULL
            SELECT TOP (1) @Id = Id
            FROM dbo.Platform_Credentials WITH (UPDLOCK, HOLDLOCK)
            WHERE Platform = @Platform AND StatusCode = 'ACTIVE'
              AND (@Platform IN ('YOUTUBE', 'TIKTOK', 'LINKEDIN', 'LINKEDIN_ORG', 'TEAMS') OR PublicId = @PublicId)
            ORDER BY Id DESC;

        IF @Id IS NULL
        BEGIN
            IF @SecretCipher IS NULL
                THROW 50001, N'Falta el secreto.', 1;

            INSERT INTO dbo.Platform_Credentials (Platform, Name, PublicId, SecretCipher, Settings, StatusCode, CreatedBy, CreatedAt)
            VALUES (@Platform, @Name, @PublicId, @SecretCipher, @Settings, 'ACTIVE', @UserName, @CurrentDate);

            SET @Id = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.Platform_Credentials
            SET Name         = @Name,
                PublicId     = @PublicId,
                SecretCipher = COALESCE(@SecretCipher, SecretCipher),
                Settings     = @Settings,
                UpdatedBy    = @UserName,
                UpdatedAt    = @CurrentDate
            WHERE Id = @Id AND Platform = @Platform AND StatusCode = 'ACTIVE';

            IF @@ROWCOUNT = 0
                THROW 50002, N'La clave no existe o fue eliminada. Recarga la página.', 1;
        END

        COMMIT TRANSACTION;

        SELECT @Id AS Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* Un bot con canales conectados no se puede borrar: primero se quitan esos canales. */
CREATE OR ALTER PROCEDURE dbo.USP_CREDENTIAL_DELETE
    @Id          INT,
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @InUse INT = (SELECT COUNT(*) FROM dbo.Social_Connections WHERE CredentialId = @Id AND StatusCode <> 'REVOKED');
    DECLARE @MessageError NVARCHAR(400);

    IF @InUse > 0
    BEGIN
        SET @MessageError = CONCAT(N'Hay ', @InUse, N' cuenta(s) conectada(s) con esta clave. Quítalas en Conexiones antes de borrarla.');
        THROW 50012, @MessageError, 1;
    END

    UPDATE dbo.Platform_Credentials
    SET StatusCode = 'DELETED', UpdatedBy = @UserName, UpdatedAt = @CurrentDate
    WHERE Id = @Id AND StatusCode = 'ACTIVE';

    IF @@ROWCOUNT = 0
        THROW 50002, N'La clave no existe o ya fue eliminada.', 1;

    SELECT Platform FROM dbo.Platform_Credentials WHERE Id = @Id;
END
GO

PRINT N'5. Claves OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   6. AVISOS Y CUOTA
   --------------------------------------------------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.USP_NOTIFICATION_LIST
    @Top INT = 30
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@Top) E.Id, E.PublicationId, E.VideoId, COALESCE(V.Title, PO.Title) AS VideoTitle, E.Target,
           COALESCE(C.Alias, C.DisplayName) AS ConnectionName, E.StatusCode, E.Message, E.IsRead, E.CreatedAt
    FROM dbo.Publication_Events AS E
    INNER JOIN dbo.Publications AS P ON P.Id = E.PublicationId
    INNER JOIN dbo.Posts AS PO ON PO.Id = P.PostId
    LEFT JOIN dbo.Media_Assets AS V ON V.Id = E.VideoId
    INNER JOIN dbo.Social_Connections AS C ON C.Id = P.ConnectionId
    WHERE E.IsNotification = 1
    ORDER BY E.Id DESC;
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_NOTIFICATION_READ
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Publication_Events
    SET IsRead = 1
    WHERE IsNotification = 1 AND IsRead = 0;
END
GO

/* @ConnectionId = canal que gastó la cuota (0 si aún no hay fila, por ejemplo al conectar). */
CREATE OR ALTER PROCEDURE dbo.USP_BG_QUOTA_ADD
    @DayPt        DATE,
    @Bucket       VARCHAR(20),
    @Units        INT,
    @ConnectionId INT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    UPDATE dbo.Youtube_Quota_Usage WITH (UPDLOCK, SERIALIZABLE)
    SET Units = Units + @Units
    WHERE DayPt = @DayPt AND Bucket = @Bucket AND ConnectionId = @ConnectionId;

    IF @@ROWCOUNT = 0
        INSERT INTO dbo.Youtube_Quota_Usage (DayPt, Bucket, ConnectionId, Units) VALUES (@DayPt, @Bucket, @ConnectionId, @Units);

    COMMIT TRANSACTION;
END
GO

/* Total del proyecto (el límite de Google) y el desglose por canal. */
CREATE OR ALTER PROCEDURE dbo.USP_QUOTA_GET
    @DayPt DATE
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Bucket, SUM(Units) AS Units
    FROM dbo.Youtube_Quota_Usage
    WHERE DayPt = @DayPt
    GROUP BY Bucket;

    SELECT Q.ConnectionId,
           COALESCE(C.Alias, C.DisplayName, N'Al conectar') AS DisplayName,
           SUM(IIF(Q.Bucket = 'UPLOADS', Q.Units, 0)) AS Uploads,
           SUM(IIF(Q.Bucket = 'GENERAL', Q.Units, 0)) AS Units
    FROM dbo.Youtube_Quota_Usage AS Q
    LEFT JOIN dbo.Social_Connections AS C ON C.Id = Q.ConnectionId
    WHERE Q.DayPt = @DayPt
    GROUP BY Q.ConnectionId, COALESCE(C.Alias, C.DisplayName, N'Al conectar')
    ORDER BY Uploads DESC, Units DESC;
END
GO

PRINT N'6. Avisos y cuota OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   7. BIBLIOTECA AMPLIADA, PLANTILLAS Y FIRMAS
   --------------------------------------------------------------------------------------------------------------------- */

/* Etiquetas en uso con cuántos videos (listos) tiene cada una. */
CREATE OR ALTER PROCEDURE dbo.USP_TAG_LIST
AS
BEGIN
    SET NOCOUNT ON;

    SELECT T.Tag, COUNT(*) AS VideoCount
    FROM dbo.Media_Tags AS T
    INNER JOIN dbo.Media_Assets AS V ON V.Id = T.VideoId AND V.StatusCode = 'READY'
    GROUP BY T.Tag
    ORDER BY COUNT(*) DESC, T.Tag;
END
GO

/* Añade y quita etiquetas a varios videos a la vez. Listas en JSON: [1,2,3] y ["promo","cocina"]. */
CREATE OR ALTER PROCEDURE dbo.USP_VIDEO_TAGS_SET
    @VideoIds NVARCHAR(MAX),
    @Add      NVARCHAR(MAX) = NULL,
    @Remove   NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Videos TABLE (Id INT PRIMARY KEY);
    INSERT INTO @Videos (Id)
    SELECT DISTINCT V.Id
    FROM OPENJSON(@VideoIds) AS J
    INNER JOIN dbo.Media_Assets AS V ON V.Id = TRY_CAST(J.[value] AS INT) AND V.StatusCode = 'READY';

    BEGIN TRANSACTION;

    DELETE T
    FROM dbo.Media_Tags AS T
    INNER JOIN @Videos AS V ON V.Id = T.VideoId
    WHERE T.Tag IN (SELECT LEFT([value], 50) FROM OPENJSON(COALESCE(@Remove, N'[]')));

    INSERT INTO dbo.Media_Tags (VideoId, Tag)
    SELECT V.Id, A.Tag
    FROM @Videos AS V
    CROSS JOIN (SELECT DISTINCT LEFT([value], 50) AS Tag FROM OPENJSON(COALESCE(@Add, N'[]')) WHERE LEN([value]) > 0) AS A
    WHERE NOT EXISTS (SELECT 1 FROM dbo.Media_Tags AS T WHERE T.VideoId = V.Id AND T.Tag = A.Tag);

    COMMIT TRANSACTION;

    SELECT COUNT(*) AS Affected FROM @Videos;
END
GO

/* Devuelve la miniatura anterior para que la API borre el archivo. */
CREATE OR ALTER PROCEDURE dbo.USP_VIDEO_POSTER_SAVE
    @Id          INT,
    @PosterPath  NVARCHAR(400),
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Old TABLE (PosterPath NVARCHAR(400) NULL);

    UPDATE dbo.Media_Assets
    SET PosterPath = @PosterPath, UpdatedBy = @UserName, UpdatedAt = @CurrentDate
    OUTPUT deleted.PosterPath INTO @Old
    WHERE Id = @Id AND StatusCode = 'READY';

    IF @@ROWCOUNT = 0
        THROW 50002, N'El video no existe o fue eliminado.', 1;

    SELECT PosterPath FROM @Old;
END
GO

/*
   Plantillas propias (Usage = 'PUBLISH' o 'REPLY') y sus adjuntos, en dos resultados. @Usage NULL = todas.
   Los adjuntos borrados de la biblioteca se devuelven con Missing = 1: la plantilla avisa y al usarla se omiten.
*/
CREATE OR ALTER PROCEDURE dbo.USP_TEMPLATE_LIST
    @Usage VARCHAR(10) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, Usage, Name, Shortcut, Title, Body, Tags, Platforms, IsDefault, UseCount, LastUsedAt,
           COALESCE(UpdatedAt, CreatedAt) AS UpdatedAt
    FROM dbo.Templates
    WHERE @Usage IS NULL OR Usage = @Usage
    ORDER BY IsDefault DESC, UseCount DESC, Name;

    SELECT TM.TemplateId, TM.Position, TM.MediaId, TM.AltText,
           M.Title, M.OriginalFileName, M.ContentType, M.SizeBytes, M.DurationSec, M.Width, M.Height, M.MediaKind,
           CAST(IIF(M.PosterPath IS NOT NULL OR M.MediaKind = 'IMAGE', 1, 0) AS BIT) AS HasPoster,
           CAST(IIF(M.StatusCode = 'READY', 0, 1) AS BIT) AS Missing,
           M.CreatedBy, M.CreatedAt
    FROM dbo.Template_Media AS TM
    INNER JOIN dbo.Templates AS T ON T.Id = TM.TemplateId
    INNER JOIN dbo.Media_Assets AS M ON M.Id = TM.MediaId
    WHERE @Usage IS NULL OR T.Usage = @Usage
    ORDER BY TM.TemplateId, TM.Position;
END
GO

/*
   Alta (@Id NULL) o cambio, con los adjuntos en orden (@Media = JSON [{"id":1,"alt":"…"}, …]) en la misma transacción.
   Solo una plantilla de publicación puede ser la predeterminada; el atajo de las respuestas no se repite.
   Un adjunto nuevo debe estar disponible; uno que ya tenía la plantilla se conserva aunque se haya borrado.
*/
CREATE OR ALTER PROCEDURE dbo.USP_TEMPLATE_SAVE
    @Id          INT           = NULL,
    @Usage       VARCHAR(10),
    @Name        NVARCHAR(100),
    @Shortcut    NVARCHAR(40)  = NULL,
    @Title       NVARCHAR(255) = NULL,
    @Body        NVARCHAR(MAX) = NULL,
    @Tags        NVARCHAR(600) = NULL,
    @Platforms   VARCHAR(200)  = NULL,
    @IsDefault   BIT           = 0,
    @Media       NVARCHAR(MAX) = NULL,
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Items TABLE (Position TINYINT PRIMARY KEY, MediaId INT NOT NULL, AltText NVARCHAR(1000) NULL);

    IF @Media IS NOT NULL AND ISJSON(@Media) = 0
        THROW 50006, N'La lista de archivos no es válida.', 1;
    IF EXISTS (SELECT 1 FROM dbo.Templates WHERE Usage = @Usage AND Name = @Name AND (@Id IS NULL OR Id <> @Id))
        THROW 50020, N'Ya existe una plantilla con ese nombre.', 1;
    IF @Shortcut IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.Templates WHERE Shortcut = @Shortcut AND (@Id IS NULL OR Id <> @Id))
        THROW 50044, N'Ya existe una respuesta con ese atajo.', 1;

    INSERT INTO @Items (Position, MediaId, AltText)
    SELECT CAST(J.[key] AS TINYINT), CAST(JSON_VALUE(J.[value], '$.id') AS INT), NULLIF(LEFT(JSON_VALUE(J.[value], '$.alt'), 1000), N'')
    FROM OPENJSON(COALESCE(@Media, N'[]')) AS J;

    IF EXISTS (SELECT 1 FROM @Items AS I
               WHERE NOT EXISTS (SELECT 1 FROM dbo.Media_Assets AS M WHERE M.Id = I.MediaId AND M.StatusCode = 'READY')
                 AND NOT EXISTS (SELECT 1 FROM dbo.Template_Media AS TM WHERE TM.TemplateId = @Id AND TM.MediaId = I.MediaId))
        THROW 50002, N'Uno de los archivos ya no existe o fue eliminado. Recarga la biblioteca.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF @IsDefault = 1
            UPDATE dbo.Templates SET IsDefault = 0 WHERE Usage = @Usage AND IsDefault = 1 AND (@Id IS NULL OR Id <> @Id);

        IF @Id IS NULL
        BEGIN
            INSERT INTO dbo.Templates (Usage, Name, Shortcut, Title, Body, Tags, Platforms, IsDefault, CreatedBy, CreatedAt)
            VALUES (@Usage, @Name, @Shortcut, @Title, @Body, @Tags, @Platforms, @IsDefault, @UserName, @CurrentDate);
            SET @Id = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.Templates
            SET Usage = @Usage, Name = @Name, Shortcut = @Shortcut, Title = @Title, Body = @Body, Tags = @Tags,
                Platforms = @Platforms, IsDefault = @IsDefault, UpdatedBy = @UserName, UpdatedAt = @CurrentDate
            WHERE Id = @Id;

            IF @@ROWCOUNT = 0
                THROW 50002, N'La plantilla no existe. Recarga la página.', 1;

            DELETE FROM dbo.Template_Media WHERE TemplateId = @Id;
        END

        INSERT INTO dbo.Template_Media (TemplateId, Position, MediaId, AltText)
        SELECT @Id, Position, MediaId, AltText FROM @Items;

        COMMIT TRANSACTION;
        SELECT @Id AS Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_TEMPLATE_DELETE
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM dbo.Templates WHERE Id = @Id;   -- Template_Media: ON DELETE CASCADE
    SELECT @@ROWCOUNT AS Affected;
END
GO

/* Se usó la plantilla (publicar o responder): sirve para ordenar la lista por las más usadas. */
CREATE OR ALTER PROCEDURE dbo.USP_TEMPLATE_USED
    @Id          INT,
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Templates SET UseCount = UseCount + 1, LastUsedAt = @CurrentDate WHERE Id = @Id;
    SELECT @@ROWCOUNT AS Affected;
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_HASHTAG_BLOCK_LIST
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, Name, Content, COALESCE(UpdatedAt, CreatedAt) AS UpdatedAt
    FROM dbo.Hashtag_Blocks
    ORDER BY Name;
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_HASHTAG_BLOCK_SAVE
    @Id          INT            = NULL,
    @Name        NVARCHAR(50),
    @Content     NVARCHAR(1000),
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM dbo.Hashtag_Blocks WHERE Name = @Name AND (@Id IS NULL OR Id <> @Id))
        THROW 50020, N'Ya existe un bloque de hashtags con ese nombre.', 1;

    IF @Id IS NULL
    BEGIN
        INSERT INTO dbo.Hashtag_Blocks (Name, Content, CreatedBy, CreatedAt) VALUES (@Name, @Content, @UserName, @CurrentDate);
        SET @Id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.Hashtag_Blocks SET Name = @Name, Content = @Content, UpdatedAt = @CurrentDate WHERE Id = @Id;
        IF @@ROWCOUNT = 0
            THROW 50002, N'El bloque no existe. Recarga la página.', 1;
    END

    SELECT @Id AS Id;
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_HASHTAG_BLOCK_DELETE
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM dbo.Hashtag_Blocks WHERE Id = @Id;
    SELECT @@ROWCOUNT AS Affected;
END
GO

/* Firma de una cuenta ({firma_cuenta} en las plantillas). Vacía = sin firma. */
CREATE OR ALTER PROCEDURE dbo.USP_CONNECTION_SIGNATURE_SAVE
    @Id        INT,
    @Signature NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Social_Connections
    SET Signature = NULLIF(LTRIM(RTRIM(@Signature)), N'')
    WHERE Id = @Id AND StatusCode <> 'REVOKED';

    IF @@ROWCOUNT = 0
        THROW 50002, N'La cuenta no existe o fue quitada.', 1;

    SELECT 1 AS Affected;
END
GO

PRINT N'7. Biblioteca ampliada, plantillas y firmas OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   8. CALENDARIO
   --------------------------------------------------------------------------------------------------------------------- */

/*
   Publicaciones de un rango (UTC) para el calendario: las programadas por su PublishAt y las inmediatas por cuándo
   se publicaron (o se pidieron, si aún no). CanReschedule = aún no está en la plataforma.
*/
CREATE OR ALTER PROCEDURE dbo.USP_PUBLICATION_CALENDAR
    @From DATETIME2(3),
    @To   DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        P.Id,
        P.VideoId,
        P.PostId,
        PO.Kind                          AS PostKind,
        COALESCE(V.Title, PO.Title)      AS VideoTitle,
        CAST(IIF(V.PosterPath IS NOT NULL OR V.MediaKind = 'IMAGE', 1, 0) AS BIT) AS HasPoster,
        P.Target,
        P.ConnectionId,
        COALESCE(C.Alias, C.DisplayName) AS ConnectionName,
        C.AvatarUrl                      AS ConnectionAvatarUrl,
        P.Title,
        P.StatusCode,
        P.PublishAt,
        X.[When],
        P.ExternalUrl,
        CAST(IIF(P.StatusCode IN ('PENDING', 'WAITING_QUOTA', 'NEEDS_RECONNECT'), 1, 0) AS BIT) AS CanReschedule
    FROM dbo.Publications AS P
    INNER JOIN dbo.Posts AS PO ON PO.Id = P.PostId
    LEFT JOIN dbo.Media_Assets AS V ON V.Id = P.VideoId
    INNER JOIN dbo.Social_Connections AS C ON C.Id = P.ConnectionId
    CROSS APPLY (SELECT COALESCE(CONVERT(DATETIME2(3), SWITCHOFFSET(P.PublishAt, '+00:00')), P.CompletedAt, P.RequestedAt) AS [When]) AS X
    WHERE P.StatusCode <> 'CANCELLED'
      AND X.[When] >= @From AND X.[When] < @To
    ORDER BY X.[When], P.Id;
END
GO

/*
   Mueve una publicación que aún no está en la plataforma (la ventana de cada plataforma la valida la API).
   @PublishAt NULL = publicar en cuanto se pueda. En YouTube un video programado se sube como privado y YouTube
   lo hace público a la hora indicada.
*/
CREATE OR ALTER PROCEDURE dbo.USP_PUBLICATION_RESCHEDULE
    @Id          BIGINT,
    @PublishAt   DATETIMEOFFSET(0) = NULL,
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @StatusCode VARCHAR(20), @Found BIT = 0;

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @Found = 1, @StatusCode = StatusCode
        FROM dbo.Publications WITH (UPDLOCK, ROWLOCK)
        WHERE Id = @Id;

        IF @Found = 0
            THROW 50002, N'La publicación no existe. Recarga el calendario.', 1;

        IF @StatusCode NOT IN ('PENDING', 'WAITING_QUOTA', 'NEEDS_RECONNECT')
            THROW 50030, N'Ya se está subiendo o ya está en la plataforma: no se puede mover.', 1;

        UPDATE dbo.Publications
        SET PublishAt     = @PublishAt,
            PrivacyStatus = IIF(Target = 'YOUTUBE' AND @PublishAt IS NOT NULL, 'private', PrivacyStatus),
            NextAttemptAt = IIF(StatusCode = 'PENDING', dbo.UFN_PUBLICATION_START(Target, @PublishAt, @CurrentDate), NextAttemptAt),
            UpdatedBy     = @UserName,
            UpdatedAt     = @CurrentDate
        WHERE Id = @Id;

        INSERT INTO dbo.Publication_Events (PublicationId, VideoId, Target, StatusCode, Message, IsNotification, IsRead, CreatedAt)
        SELECT Id, VideoId, Target, StatusCode,
               IIF(@PublishAt IS NULL, CONCAT(N'Se publicará en cuanto se pueda (', @UserName, N').'),
                   CONCAT(N'Reprogramada para ', FORMAT(@PublishAt, 'dd/MM/yyyy HH:mm'), N' UTC por ', @UserName, N'.')),
               0, 1, @CurrentDate
        FROM dbo.Publications
        WHERE Id = @Id;

        COMMIT TRANSACTION;

        SELECT 1 AS Affected, VideoId, Target, StatusCode FROM dbo.Publications WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* Plataforma de una publicación (la API valida con ella la ventana de programación antes de moverla). */
CREATE OR ALTER PROCEDURE dbo.USP_PUBLICATION_TARGET
    @Id BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Target FROM dbo.Publications WHERE Id = @Id;
END
GO

PRINT N'8. Calendario OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   9. MÉTRICAS, RESULTADOS Y SALUD
   --------------------------------------------------------------------------------------------------------------------- */

/* Publicaciones de los últimos 90 días cuyas métricas faltan o tienen más de 20 h (las más viejas primero). */
CREATE OR ALTER PROCEDURE dbo.USP_BG_METRICS_DUE_LIST
    @Top         INT,
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@Top)
        P.Id,
        P.Target,
        P.ExternalId,
        P.ConnectionId,
        C.ConnectionKey,
        C.ExternalId AS AccountExternalId
    FROM dbo.Publications AS P
    INNER JOIN dbo.Social_Connections AS C ON C.Id = P.ConnectionId AND C.StatusCode = 'CONNECTED'
    LEFT JOIN dbo.Publication_Metrics AS M ON M.PublicationId = P.Id
    WHERE P.StatusCode = 'DONE'
      AND P.Target IN ('YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'LINKEDIN')   -- las que tienen recolector de métricas
      AND P.ExternalId IS NOT NULL
      AND P.CompletedAt >= DATEADD(DAY, -90, @CurrentDate)
      AND (M.CollectedAt IS NULL OR M.CollectedAt < DATEADD(HOUR, -20, @CurrentDate))
    ORDER BY M.CollectedAt, P.Id;
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_BG_METRICS_SAVE
    @PublicationId BIGINT,
    @Views         BIGINT = NULL,
    @Likes         BIGINT = NULL,
    @Comments      BIGINT = NULL,
    @CurrentDate   DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Publication_Metrics
    SET Views = COALESCE(@Views, Views), Likes = COALESCE(@Likes, Likes), Comments = COALESCE(@Comments, Comments), CollectedAt = @CurrentDate
    WHERE PublicationId = @PublicationId;

    IF @@ROWCOUNT = 0
        INSERT INTO dbo.Publication_Metrics (PublicationId, Views, Likes, Comments, CollectedAt)
        VALUES (@PublicationId, @Views, @Likes, @Comments, @CurrentDate);

    SELECT 1 AS Affected;
END
GO

/*
   Resultados desde @From: 1) publicaciones cerradas por día; 2) por cuenta (publicadas, fallidas, métricas y
   minutos medios hasta publicarse; las programadas no cuentan para el tiempo medio).
*/
CREATE OR ALTER PROCEDURE dbo.USP_INSIGHTS
    @From DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT CAST(P.CompletedAt AS DATE) AS [Day],
           SUM(IIF(P.StatusCode = 'DONE', 1, 0))   AS Done,
           SUM(IIF(P.StatusCode = 'FAILED', 1, 0)) AS Failed
    FROM dbo.Publications AS P
    WHERE P.CompletedAt >= @From AND P.StatusCode IN ('DONE', 'FAILED')
    GROUP BY CAST(P.CompletedAt AS DATE)
    ORDER BY [Day];

    SELECT C.Id AS ConnectionId,
           C.Platform,
           COALESCE(C.Alias, C.DisplayName) AS ConnectionName,
           C.AvatarUrl,
           SUM(IIF(P.StatusCode = 'DONE', 1, 0))   AS Published,
           SUM(IIF(P.StatusCode = 'FAILED', 1, 0)) AS Failed,
           SUM(M.Views)    AS Views,
           SUM(M.Likes)    AS Likes,
           SUM(M.Comments) AS Comments,
           AVG(IIF(P.StatusCode = 'DONE' AND P.PublishAt IS NULL, CAST(DATEDIFF(SECOND, P.RequestedAt, P.CompletedAt) AS FLOAT) / 60, NULL)) AS AvgMinutes
    FROM dbo.Publications AS P
    INNER JOIN dbo.Social_Connections AS C ON C.Id = P.ConnectionId
    LEFT JOIN dbo.Publication_Metrics AS M ON M.PublicationId = P.Id
    WHERE P.CompletedAt >= @From AND P.StatusCode IN ('DONE', 'FAILED')
    GROUP BY C.Id, C.Platform, C.Alias, C.DisplayName, C.AvatarUrl
    ORDER BY Published DESC, ConnectionName;
END
GO

/* Estado de la cola y de las cuentas para el panel de salud (una fila). */
CREATE OR ALTER PROCEDURE dbo.USP_SYSTEM_HEALTH
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        (SELECT COUNT(*) FROM dbo.Publications
         WHERE StatusCode IN ('PENDING', 'UPLOADING', 'WAITING_QUOTA') AND (NextAttemptAt IS NULL OR NextAttemptAt <= @CurrentDate)) AS QueueDue,
        (SELECT COUNT(*) FROM dbo.Publications WHERE StatusCode = 'PROCESSING') AS Processing,
        (SELECT COUNT(*) FROM dbo.Publications
         WHERE StatusCode IN ('PENDING', 'WAITING_QUOTA') AND NextAttemptAt > @CurrentDate) AS Scheduled,
        (SELECT MAX(DATEDIFF(MINUTE, COALESCE(NextAttemptAt, RequestedAt), @CurrentDate)) FROM dbo.Publications
         WHERE StatusCode = 'PENDING' AND (NextAttemptAt IS NULL OR NextAttemptAt <= @CurrentDate)) AS OldestDueMinutes,
        (SELECT COUNT(*) FROM dbo.Publications WHERE StatusCode = 'UPLOADING' AND LeaseUntil < @CurrentDate) AS StuckUploads,
        (SELECT COUNT(*) FROM dbo.Publications WHERE StatusCode = 'NEEDS_REVIEW') AS NeedsReview,
        (SELECT COUNT(*) FROM dbo.Publications WHERE StatusCode = 'FAILED' AND CompletedAt >= DATEADD(DAY, -7, @CurrentDate)) AS FailedLast7Days,
        (SELECT COUNT(*) FROM dbo.Social_Connections WHERE StatusCode = 'NEEDS_RECONNECT') AS ConnectionsNeedingReconnect,
        (SELECT COUNT(*) FROM dbo.Social_Connections
         WHERE StatusCode = 'CONNECTED' AND TokenExpiresAt BETWEEN @CurrentDate AND DATEADD(DAY, 7, @CurrentDate)) AS TokensExpiringSoon,
        (SELECT COUNT(*) FROM dbo.Social_Connections WHERE StatusCode = 'CONNECTED' AND LastTestOk = 0) AS ConnectionsFailingTest,
        -- Bandeja: avisos que no se pudieron procesar, envíos fallidos o dudosos y consultas con error.
        (SELECT COUNT(*) FROM dbo.Inbox_Events WHERE StatusCode = 'FAILED' AND ReceivedAt >= DATEADD(DAY, -7, @CurrentDate)) AS InboxEventsFailed,
        (SELECT COUNT(*) FROM dbo.Inbox_Messages
         WHERE Direction = 'OUT' AND StatusCode IN ('FAILED', 'NEEDS_REVIEW') AND SentAt >= DATEADD(DAY, -7, @CurrentDate)) AS InboxSendProblems,
        (SELECT COUNT(*) FROM dbo.Inbox_Sync_State WHERE LastError IS NOT NULL) AS InboxSyncErrors;
END
GO

PRINT N'9. Métricas, resultados y salud OK.';
GO


/* Cancela lo vivo de las plataformas desactivadas en la configuración (Platforms:Disabled). Devuelve cuántas. */
CREATE OR ALTER PROCEDURE dbo.USP_BG_PUBLICATION_DISABLED_CANCEL
    @Platforms   NVARCHAR(400),   -- separadas por comas: LINKEDIN,TIKTOK
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Cancelled TABLE (Id BIGINT, VideoId INT, Target VARCHAR(20));

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.Publications
        SET StatusCode    = 'CANCELLED',
            NextAttemptAt = NULL,
            LeaseOwner    = NULL,
            LeaseUntil    = NULL,
            ErrorCode     = 'PLATFORM_DISABLED',
            ErrorMessage  = CONCAT(dbo.UFN_PLATFORM_LABEL(Target), N' está desactivado en esta instalación.'),
            UpdatedBy     = N'sistema',
            UpdatedAt     = @CurrentDate
        OUTPUT inserted.Id, inserted.VideoId, inserted.Target INTO @Cancelled
        WHERE Target IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@Platforms, ','))
          AND StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW');

        INSERT INTO dbo.Publication_Events (PublicationId, VideoId, Target, StatusCode, Message, IsNotification, IsRead, CreatedAt)
        SELECT Id, VideoId, Target, 'CANCELLED',
               CONCAT(dbo.UFN_PLATFORM_LABEL(Target), N' está desactivado en esta instalación: la publicación se canceló.'), 1, 0, @CurrentDate
        FROM @Cancelled;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH

    SELECT COUNT(*) AS Cancelled FROM @Cancelled;
END
GO

/* Publicaciones ya hechas de una cuenta (para leer sus respuestas: hilos de Teams). */
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_PUBLICATIONS_RECENT
    @ConnectionId INT,
    @Since        DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT P.Id, P.ExternalId, P.ExternalUrl, P.Title, P.CompletedAt
    FROM dbo.Publications AS P
    WHERE P.ConnectionId = @ConnectionId AND P.StatusCode = 'DONE' AND P.ExternalId IS NOT NULL AND P.CompletedAt >= @Since
    ORDER BY P.CompletedAt DESC;
END
GO

PRINT N'9b. Plataformas desactivadas OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   10. BANDEJA
   Entrada:  webhook o consulta -> USP_INBOX_EVENT_SAVE (crudo, idempotente) -> job: USP_BG_INBOX_EVENT_DUE_LIST ->
             adaptador de la plataforma -> USP_BG_INBOX_INGEST (contacto, conversación y mensaje, idempotente).
   Salida:   USP_INBOX_MESSAGE_CREATE (QUEUED) -> job: USP_BG_INBOX_SEND_DUE_LIST (SENDING, lease) ->
             USP_BG_INBOX_SEND_RESULT (SENT / FAILED / NEEDS_REVIEW). Mismo patrón de lease que Publications.
   --------------------------------------------------------------------------------------------------------------------- */

/* Guarda un aviso en crudo. Inserted = 0 si ya estaba (la plataforma reintentó el mismo aviso). */
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_EVENT_SAVE
    @Platform    VARCHAR(20),
    @EventKey    NVARCHAR(200),
    @Payload     NVARCHAR(MAX),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.Inbox_Events (Platform, EventKey, Payload, StatusCode, NextAttemptAt, ReceivedAt)
    SELECT @Platform, @EventKey, @Payload, 'PENDING', @CurrentDate, @CurrentDate
    WHERE NOT EXISTS (SELECT 1 FROM dbo.Inbox_Events WITH (UPDLOCK, HOLDLOCK) WHERE Platform = @Platform AND EventKey = @EventKey);

    SELECT CAST(@@ROWCOUNT AS BIT) AS Inserted;
END
GO

/* Avisos recientes de una plataforma cuyo EventKey empieza por @KeyPrefix (Telegram: chats donde está el bot). */
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_EVENT_RECENT
    @Platform  VARCHAR(20),
    @KeyPrefix NVARCHAR(100),
    @Since     DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (500) Payload
    FROM dbo.Inbox_Events
    WHERE Platform = @Platform AND ReceivedAt >= @Since AND EventKey LIKE CONCAT(@KeyPrefix, N'%')
    ORDER BY Id DESC;
END
GO

/* Reserva avisos pendientes (o fallidos con reintento vencido) en orden de llegada. */
CREATE OR ALTER PROCEDURE dbo.USP_BG_INBOX_EVENT_DUE_LIST
    @Top          INT,
    @LeaseOwner   VARCHAR(100),
    @LeaseMinutes INT,
    @MaxAttempts  INT,
    @CurrentDate  DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Taken TABLE (Id BIGINT PRIMARY KEY);

    WITH Due AS
    (
        SELECT TOP (@Top) E.Id, E.Attempts, E.LeaseOwner, E.LeaseUntil
        FROM dbo.Inbox_Events AS E WITH (UPDLOCK, READPAST, ROWLOCK)
        WHERE E.StatusCode IN ('PENDING', 'FAILED')
          AND E.Attempts < @MaxAttempts
          AND (E.NextAttemptAt IS NULL OR E.NextAttemptAt <= @CurrentDate)
          AND (E.LeaseUntil IS NULL OR E.LeaseUntil < @CurrentDate)
        ORDER BY E.Id
    )
    UPDATE Due
    SET LeaseOwner = @LeaseOwner,
        LeaseUntil = DATEADD(MINUTE, @LeaseMinutes, @CurrentDate),
        Attempts   = Attempts + 1
    OUTPUT inserted.Id INTO @Taken (Id);

    SELECT E.Id, E.Platform, E.EventKey, E.Payload, E.Attempts
    FROM @Taken AS T
    INNER JOIN dbo.Inbox_Events AS E ON E.Id = T.Id
    ORDER BY E.Id;
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_BG_INBOX_EVENT_RESULT
    @Id            BIGINT,
    @LeaseOwner    VARCHAR(100),
    @StatusCode    VARCHAR(10),
    @ErrorMessage  NVARCHAR(500) = NULL,
    @NextAttemptAt DATETIME2(3)  = NULL,
    @CurrentDate   DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Inbox_Events
    SET StatusCode    = @StatusCode,
        ErrorMessage  = LEFT(@ErrorMessage, 500),
        NextAttemptAt = @NextAttemptAt,
        ProcessedAt   = IIF(@StatusCode = 'DONE', @CurrentDate, ProcessedAt),
        LeaseOwner    = NULL,
        LeaseUntil    = NULL
    WHERE Id = @Id AND LeaseOwner = @LeaseOwner;

    SELECT @@ROWCOUNT AS Affected;
END
GO

/*
   Guarda un mensaje ya normalizado por el adaptador: contacto, conversación y mensaje. Idempotente: un mensaje que ya
   está (mismo ExternalId en la conversación) no se duplica ni vuelve a contar como no leído. El eco de un mensaje que la
   app está enviando (SENDING, mismo texto) se une a ese mensaje en lugar de duplicarlo.
*/
CREATE OR ALTER PROCEDURE dbo.USP_BG_INBOX_INGEST
    @ConnectionId           INT,
    @Kind                   VARCHAR(10),
    @ConversationExternalId NVARCHAR(200),
    @Title                  NVARCHAR(300)  = NULL,
    @Link                   NVARCHAR(500)  = NULL,
    @PublicationExternalId  NVARCHAR(100)  = NULL,
    @ContactExternalId      NVARCHAR(200)  = NULL,
    @ContactName            NVARCHAR(200)  = NULL,
    @ContactHandle          NVARCHAR(200)  = NULL,
    @ContactAvatarUrl       NVARCHAR(1000) = NULL,
    @MessageExternalId      NVARCHAR(200),
    @ParentExternalId       NVARCHAR(200)  = NULL,
    @Direction              VARCHAR(4),
    @AuthorName             NVARCHAR(200)  = NULL,
    @AuthorExternalId       NVARCHAR(200)  = NULL,
    @Body                   NVARCHAR(MAX)  = NULL,
    @Attachments            NVARCHAR(MAX)  = NULL,
    @SentAt                 DATETIME2(3),
    @CurrentDate            DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Platform VARCHAR(20), @ContactId INT, @ConversationId BIGINT, @MessageId BIGINT, @PublicationId BIGINT, @IsNew BIT = 0;

    SELECT @Platform = Platform FROM dbo.Social_Connections WHERE Id = @ConnectionId;
    IF @Platform IS NULL
        THROW 50040, N'La cuenta de la bandeja no existe.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF @ContactExternalId IS NOT NULL
        BEGIN
            SELECT @ContactId = Id
            FROM dbo.Inbox_Contacts WITH (UPDLOCK, HOLDLOCK)
            WHERE Platform = @Platform AND ExternalId = @ContactExternalId;

            IF @ContactId IS NULL
            BEGIN
                INSERT INTO dbo.Inbox_Contacts (Platform, ExternalId, DisplayName, Handle, AvatarUrl, CreatedAt)
                VALUES (@Platform, @ContactExternalId, LEFT(COALESCE(NULLIF(@ContactName, N''), @ContactHandle, @ContactExternalId), 200),
                        @ContactHandle, @ContactAvatarUrl, @CurrentDate);
                SET @ContactId = SCOPE_IDENTITY();
            END
            ELSE IF NULLIF(@ContactName, N'') IS NOT NULL OR @ContactHandle IS NOT NULL OR @ContactAvatarUrl IS NOT NULL
                UPDATE dbo.Inbox_Contacts
                SET DisplayName = LEFT(COALESCE(NULLIF(@ContactName, N''), DisplayName), 200),
                    Handle      = COALESCE(@ContactHandle, Handle),
                    AvatarUrl   = COALESCE(@ContactAvatarUrl, AvatarUrl),
                    UpdatedAt   = @CurrentDate
                WHERE Id = @ContactId;
        END

        IF @PublicationExternalId IS NOT NULL
            SELECT TOP (1) @PublicationId = Id
            FROM dbo.Publications
            WHERE ConnectionId = @ConnectionId AND ExternalId = @PublicationExternalId
            ORDER BY Id DESC;

        SELECT @ConversationId = Id
        FROM dbo.Inbox_Conversations WITH (UPDLOCK, HOLDLOCK)
        WHERE ConnectionId = @ConnectionId AND Kind = @Kind AND ExternalId = @ConversationExternalId;

        IF @ConversationId IS NULL
        BEGIN
            INSERT INTO dbo.Inbox_Conversations (ConnectionId, Kind, ExternalId, ContactId, PublicationId, Title, Link, StatusCode, UnreadCount, LastMessageAt, CreatedAt)
            VALUES (@ConnectionId, @Kind, @ConversationExternalId, @ContactId, @PublicationId,
                    LEFT(COALESCE((SELECT Title FROM dbo.Publications WHERE Id = @PublicationId), NULLIF(@Title, N''), N'Conversación'), 300),
                    @Link, 'OPEN', 0, @SentAt, @CurrentDate);
            SET @ConversationId = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.Inbox_Conversations
            SET ContactId     = COALESCE(ContactId, @ContactId),
                PublicationId = COALESCE(PublicationId, @PublicationId),
                Link          = COALESCE(Link, @Link),
                -- Los nombres cambian (grupos, personas); el de una publicación propia se conserva.
                Title         = IIF(PublicationId IS NULL AND NULLIF(@Title, N'') IS NOT NULL, LEFT(@Title, 300), Title)
            WHERE Id = @ConversationId;

        SELECT @MessageId = Id FROM dbo.Inbox_Messages WHERE ConversationId = @ConversationId AND ExternalId = @MessageExternalId;

        -- Eco de un envío propio todavía en curso: se le asigna el id en lugar de crear otro mensaje.
        IF @MessageId IS NULL AND @Direction = 'OUT'
        BEGIN
            SELECT TOP (1) @MessageId = Id
            FROM dbo.Inbox_Messages
            WHERE ConversationId = @ConversationId AND Direction = 'OUT' AND StatusCode = 'SENDING' AND ExternalId IS NULL
              AND COALESCE(Body, N'') = COALESCE(@Body, N'')
            ORDER BY Id;

            IF @MessageId IS NOT NULL
                UPDATE dbo.Inbox_Messages SET ExternalId = @MessageExternalId, UpdatedAt = @CurrentDate WHERE Id = @MessageId;
        END

        IF @MessageId IS NULL
        BEGIN
            INSERT INTO dbo.Inbox_Messages
                (ConversationId, ExternalId, ParentExternalId, Direction, AuthorName, AuthorExternalId, Body, Attachments, SentAt, StatusCode,
                 ResponseSeconds, CreatedAt)
            SELECT @ConversationId, @MessageExternalId, @ParentExternalId, @Direction, LEFT(@AuthorName, 200), @AuthorExternalId, @Body, @Attachments,
                   @SentAt, IIF(@Direction = 'IN', 'RECEIVED', 'SENT'),
                   IIF(@Direction = 'OUT' AND C.AwaitingSince <= @SentAt, DATEDIFF(SECOND, C.AwaitingSince, @SentAt), NULL),
                   @CurrentDate
            FROM dbo.Inbox_Conversations AS C
            WHERE C.Id = @ConversationId;

            SET @MessageId = SCOPE_IDENTITY();
            SET @IsNew = 1;

            UPDATE dbo.Inbox_Conversations
            SET UnreadCount        = UnreadCount + IIF(@Direction = 'IN', 1, 0),
                LastMessagePreview = IIF(@SentAt >= LastMessageAt, LEFT(COALESCE(NULLIF(@Body, N''), N'📎 Adjunto'), 200), LastMessagePreview),
                LastMessageAt      = IIF(@SentAt > LastMessageAt, @SentAt, LastMessageAt),
                LastInboundAt      = IIF(@Direction = 'IN' AND (LastInboundAt IS NULL OR @SentAt > LastInboundAt), @SentAt, LastInboundAt),
                AwaitingSince      = CASE WHEN @Direction = 'IN' THEN COALESCE(AwaitingSince, @SentAt)
                                          WHEN @Direction = 'OUT' AND AwaitingSince <= @SentAt THEN NULL
                                          ELSE AwaitingSince END,
                StatusCode         = IIF(@Direction = 'IN', 'OPEN', StatusCode),
                UpdatedAt          = @CurrentDate
            WHERE Id = @ConversationId;
        END

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH

    SELECT @ConversationId AS ConversationId, @MessageId AS MessageId, @IsNew AS IsNew;
END
GO

/* Acuse de entrega, lectura o fallo de un mensaje saliente (WhatsApp, Messenger). Solo avanza: enviado < entregado < leído. */
CREATE OR ALTER PROCEDURE dbo.USP_BG_INBOX_STATUS_SAVE
    @Platform     VARCHAR(20),
    @ExternalId   NVARCHAR(200),
    @StatusCode   VARCHAR(15),
    @ErrorMessage NVARCHAR(500) = NULL,
    @CurrentDate  DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Changed TABLE (ConversationId BIGINT);

    UPDATE M
    SET StatusCode   = @StatusCode,
        ErrorMessage = COALESCE(LEFT(@ErrorMessage, 500), M.ErrorMessage),
        UpdatedAt    = @CurrentDate
    OUTPUT inserted.ConversationId INTO @Changed
    FROM dbo.Inbox_Messages AS M
    INNER JOIN dbo.Inbox_Conversations AS C ON C.Id = M.ConversationId
    INNER JOIN dbo.Social_Connections AS S ON S.Id = C.ConnectionId
    WHERE M.ExternalId = @ExternalId AND M.Direction = 'OUT' AND S.Platform = @Platform
      AND (@StatusCode = 'FAILED'
           OR CASE M.StatusCode WHEN 'SENT' THEN 1 WHEN 'DELIVERED' THEN 2 WHEN 'READ' THEN 3 ELSE 9 END
              < CASE @StatusCode WHEN 'SENT' THEN 1 WHEN 'DELIVERED' THEN 2 WHEN 'READ' THEN 3 ELSE 0 END);

    SELECT TOP (1) ConversationId FROM @Changed;
END
GO

/*
   Conversaciones, de la más reciente a la más antigua, con paginación por cursor (@BeforeAt + @BeforeId).
   Con @Id devuelve solo esa (la misma forma que el listado).
*/
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_CONVERSATION_LIST
    @Id           BIGINT        = NULL,
    @StatusCode   VARCHAR(10)   = NULL,
    @Platform     VARCHAR(20)   = NULL,
    @Kind         VARCHAR(10)   = NULL,
    @ConnectionId INT           = NULL,
    @UnreadOnly   BIT           = 0,
    @AwaitingOnly BIT           = 0,
    @Tag          NVARCHAR(50)  = NULL,
    @SearchTerm   NVARCHAR(200) = NULL,
    @BeforeAt     DATETIME2(3)  = NULL,
    @BeforeId     BIGINT        = NULL,
    @Take         INT           = 30
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Pattern NVARCHAR(210) =
        IIF(NULLIF(LTRIM(RTRIM(@SearchTerm)), N'') IS NULL, NULL,
            CONCAT(N'%', REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(@SearchTerm)), N'[', N'[[]'), N'%', N'[%]'), N'_', N'[_]'), N'%'));

    SELECT TOP (@Take)
        C.Id, C.ConnectionId, S.Platform, COALESCE(S.Alias, S.DisplayName) AS AccountName, S.AvatarUrl AS AccountAvatarUrl,
        C.Kind, C.ExternalId, C.Title, C.Link, C.StatusCode, C.UnreadCount, C.LastMessageAt, C.LastMessagePreview, C.LastInboundAt,
        C.AwaitingSince, C.AssignedTo, C.PublicationId, P.VideoId, C.ContactId,
        K.DisplayName AS ContactName, K.Handle AS ContactHandle, K.AvatarUrl AS ContactAvatarUrl,
        (SELECT STRING_AGG(T.Tag, N',') WITHIN GROUP (ORDER BY T.Tag) FROM dbo.Inbox_Conversation_Tags AS T WHERE T.ConversationId = C.Id) AS Tags
    FROM dbo.Inbox_Conversations AS C
    INNER JOIN dbo.Social_Connections AS S ON S.Id = C.ConnectionId
    LEFT JOIN dbo.Inbox_Contacts AS K ON K.Id = C.ContactId
    LEFT JOIN dbo.Publications AS P ON P.Id = C.PublicationId
    WHERE (@Id IS NULL OR C.Id = @Id)
      AND (@StatusCode IS NULL OR C.StatusCode = @StatusCode)
      AND (@Platform IS NULL OR S.Platform = @Platform)
      AND (@Kind IS NULL OR C.Kind = @Kind)
      AND (@ConnectionId IS NULL OR C.ConnectionId = @ConnectionId)
      AND (@UnreadOnly = 0 OR C.UnreadCount > 0)
      AND (@AwaitingOnly = 0 OR (C.AwaitingSince IS NOT NULL AND C.StatusCode <> 'CLOSED'))
      AND (@Tag IS NULL OR EXISTS (SELECT 1 FROM dbo.Inbox_Conversation_Tags AS T WHERE T.ConversationId = C.Id AND T.Tag = @Tag))
      AND (@Pattern IS NULL OR C.Title LIKE @Pattern OR K.DisplayName LIKE @Pattern OR K.Handle LIKE @Pattern
           OR EXISTS (SELECT 1 FROM dbo.Inbox_Messages AS M WHERE M.ConversationId = C.Id AND M.Body LIKE @Pattern))
      AND (@BeforeAt IS NULL OR C.LastMessageAt < @BeforeAt OR (C.LastMessageAt = @BeforeAt AND C.Id < @BeforeId))
    ORDER BY C.LastMessageAt DESC, C.Id DESC;
END
GO

/* Contadores de los filtros de la bandeja y del menú. */
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_COUNTS
AS
BEGIN
    SET NOCOUNT ON;

    SELECT ISNULL(SUM(IIF(StatusCode = 'OPEN', 1, 0)), 0)                                  AS [Open],
           ISNULL(SUM(IIF(StatusCode = 'PENDING', 1, 0)), 0)                               AS Pending,
           ISNULL(SUM(IIF(StatusCode = 'CLOSED', 1, 0)), 0)                                AS Closed,
           ISNULL(SUM(IIF(UnreadCount > 0, 1, 0)), 0)                                      AS Unread,
           ISNULL(SUM(IIF(AwaitingSince IS NOT NULL AND StatusCode <> 'CLOSED', 1, 0)), 0) AS Awaiting
    FROM dbo.Inbox_Conversations;
END
GO

/* Estado, leído, asignada y etiquetas (@Tags = lista separada por comas que reemplaza a la actual). */
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_CONVERSATION_UPDATE
    @Id            BIGINT,
    @StatusCode    VARCHAR(10)    = NULL,
    @MarkRead      BIT            = NULL,
    @AssignedTo    NVARCHAR(100)  = NULL,
    @ClearAssigned BIT            = 0,
    @Tags          NVARCHAR(1000) = NULL,
    @CurrentDate   DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.Inbox_Conversations
        SET StatusCode  = COALESCE(@StatusCode, StatusCode),
            UnreadCount = IIF(@MarkRead = 1, 0, UnreadCount),
            AssignedTo  = IIF(@ClearAssigned = 1, NULL, COALESCE(@AssignedTo, AssignedTo)),
            UpdatedAt   = @CurrentDate
        WHERE Id = @Id;

        IF @@ROWCOUNT = 0
            THROW 50041, N'La conversación no existe. Recarga la bandeja.', 1;

        IF @Tags IS NOT NULL
        BEGIN
            DELETE FROM dbo.Inbox_Conversation_Tags WHERE ConversationId = @Id;
            INSERT INTO dbo.Inbox_Conversation_Tags (ConversationId, Tag)
            SELECT DISTINCT @Id, LEFT(LTRIM(RTRIM(value)), 50)
            FROM STRING_SPLIT(@Tags, ',')
            WHERE LTRIM(RTRIM(value)) <> N'';
        END

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* Mensajes de una conversación, del más nuevo al más viejo (cursor @BeforeAt + @BeforeId). Con @Id, solo ese. */
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_MESSAGE_LIST
    @ConversationId BIGINT       = NULL,
    @Id             BIGINT       = NULL,
    @BeforeAt       DATETIME2(3) = NULL,
    @BeforeId       BIGINT       = NULL,
    @Take           INT          = 50
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@Take) Id, ConversationId, ExternalId, ParentExternalId, Direction, AuthorName, AuthorExternalId, Body, Attachments, Options,
           SentAt, StatusCode, ErrorMessage, Attempts, CreatedBy
    FROM dbo.Inbox_Messages
    WHERE (@Id IS NOT NULL AND Id = @Id)
       OR (@Id IS NULL AND ConversationId = @ConversationId
           AND (@BeforeAt IS NULL OR SentAt < @BeforeAt OR (SentAt = @BeforeAt AND Id < @BeforeId)))
    ORDER BY SentAt DESC, Id DESC;
END
GO

/* Respuesta (OUT, a la cola del job) o nota interna (NOTE). Responder marca la conversación como leída. */
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_MESSAGE_CREATE
    @ConversationId   BIGINT,
    @Direction        VARCHAR(4),
    @Body             NVARCHAR(MAX) = NULL,
    @Attachments      NVARCHAR(MAX) = NULL,
    @Options          NVARCHAR(MAX) = NULL,
    @ParentExternalId NVARCHAR(200) = NULL,
    @UserName         NVARCHAR(100),
    @CurrentDate      DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Id BIGINT;

    IF @Direction NOT IN ('OUT', 'NOTE')
        THROW 50006, N'Tipo de mensaje no válido.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Inbox_Conversations WHERE Id = @ConversationId)
        THROW 50041, N'La conversación no existe. Recarga la bandeja.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO dbo.Inbox_Messages
            (ConversationId, ParentExternalId, Direction, AuthorName, Body, Attachments, Options, SentAt, StatusCode, NextAttemptAt, CreatedBy, CreatedAt)
        VALUES
            (@ConversationId, @ParentExternalId, @Direction, @UserName, @Body, @Attachments, @Options, @CurrentDate,
             IIF(@Direction = 'OUT', 'QUEUED', 'SENT'), IIF(@Direction = 'OUT', @CurrentDate, NULL), @UserName, @CurrentDate);
        SET @Id = SCOPE_IDENTITY();

        IF @Direction = 'OUT'
            UPDATE dbo.Inbox_Conversations
            SET UnreadCount        = 0,
                LastMessageAt      = @CurrentDate,
                LastMessagePreview = LEFT(COALESCE(NULLIF(@Body, N''), N'📎 Adjunto'), 200),
                UpdatedAt          = @CurrentDate
            WHERE Id = @ConversationId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH

    SELECT @Id AS Id;
END
GO

/*
   Decide a mano un envío fallido o dudoso: RETRY (otra vez a la cola), MARK_SENT (la persona comprobó que llegó) o
   CANCEL. Devuelve la conversación.
*/
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_MESSAGE_RESOLVE
    @Id          BIGINT,
    @Action      VARCHAR(10),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ConversationId BIGINT;

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.Inbox_Messages
        SET StatusCode      = CASE @Action WHEN 'RETRY' THEN 'QUEUED' WHEN 'MARK_SENT' THEN 'SENT' ELSE 'CANCELLED' END,
            NextAttemptAt   = IIF(@Action = 'RETRY', @CurrentDate, NULL),
            Attempts        = IIF(@Action = 'RETRY', 0, Attempts),
            ErrorMessage    = NULL,
            UpdatedAt       = @CurrentDate,
            @ConversationId = ConversationId
        WHERE Id = @Id AND Direction = 'OUT'
          AND ((@Action = 'RETRY' AND StatusCode IN ('FAILED', 'NEEDS_REVIEW', 'CANCELLED'))
            OR (@Action = 'MARK_SENT' AND StatusCode = 'NEEDS_REVIEW')
            OR (@Action = 'CANCEL' AND StatusCode IN ('QUEUED', 'FAILED', 'NEEDS_REVIEW')));

        IF @@ROWCOUNT = 0
            THROW 50042, N'El mensaje ya cambió de estado. Recarga la conversación.', 1;

        IF @Action = 'MARK_SENT'
            UPDATE dbo.Inbox_Conversations SET AwaitingSince = NULL, UpdatedAt = @CurrentDate WHERE Id = @ConversationId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH

    SELECT @ConversationId AS ConversationId;
END
GO

/*
   Reserva respuestas en cola. Antes, un envío que se quedó en SENDING con el lease vencido (el proceso murió a mitad)
   pasa a NEEDS_REVIEW: no se puede saber si la plataforma lo recibió, así que no se reenvía solo.
*/
CREATE OR ALTER PROCEDURE dbo.USP_BG_INBOX_SEND_DUE_LIST
    @Top          INT,
    @LeaseOwner   VARCHAR(100),
    @LeaseMinutes INT,
    @CurrentDate  DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Taken TABLE (Id BIGINT PRIMARY KEY);

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.Inbox_Messages
        SET StatusCode   = 'NEEDS_REVIEW',
            ErrorMessage = N'Se cortó la comunicación mientras se enviaba y no se puede saber si llegó. Míralo en la plataforma: si ya aparece, pulsa «Ya se envió»; si no, «Reintentar».',
            LeaseOwner   = NULL,
            LeaseUntil   = NULL,
            UpdatedAt    = @CurrentDate
        WHERE Direction = 'OUT' AND StatusCode = 'SENDING' AND LeaseUntil < @CurrentDate;

        WITH Due AS
        (
            SELECT TOP (@Top) M.Id, M.StatusCode, M.LeaseOwner, M.LeaseUntil, M.Attempts, M.UpdatedAt
            FROM dbo.Inbox_Messages AS M WITH (UPDLOCK, READPAST, ROWLOCK)
            WHERE M.Direction = 'OUT' AND M.StatusCode = 'QUEUED'
              AND (M.NextAttemptAt IS NULL OR M.NextAttemptAt <= @CurrentDate)
            ORDER BY M.NextAttemptAt, M.Id
        )
        UPDATE Due
        SET StatusCode = 'SENDING',
            LeaseOwner = @LeaseOwner,
            LeaseUntil = DATEADD(MINUTE, @LeaseMinutes, @CurrentDate),
            Attempts   = Attempts + 1,
            UpdatedAt  = @CurrentDate
        OUTPUT inserted.Id INTO @Taken (Id);

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH

    SELECT M.Id, M.ConversationId, M.Body, M.Attachments, M.Options, M.ParentExternalId, M.Attempts, M.CreatedBy,
           C.Kind, C.ExternalId AS ConversationExternalId, C.LastInboundAt, K.ExternalId AS ContactExternalId,
           S.Id AS ConnectionId, S.Platform, S.ConnectionKey, S.ExternalId AS AccountExternalId, S.CredentialId,
           S.StatusCode AS ConnectionStatus, COALESCE(S.Alias, S.DisplayName) AS AccountName, S.Extra AS AccountExtra
    FROM @Taken AS T
    INNER JOIN dbo.Inbox_Messages AS M ON M.Id = T.Id
    INNER JOIN dbo.Inbox_Conversations AS C ON C.Id = M.ConversationId
    INNER JOIN dbo.Social_Connections AS S ON S.Id = C.ConnectionId
    LEFT JOIN dbo.Inbox_Contacts AS K ON K.Id = C.ContactId
    ORDER BY M.Id;
END
GO

/* Cierra un intento de envío. SENT deja la conversación respondida y guarda el tiempo de respuesta. */
CREATE OR ALTER PROCEDURE dbo.USP_BG_INBOX_SEND_RESULT
    @Id            BIGINT,
    @LeaseOwner    VARCHAR(100),
    @StatusCode    VARCHAR(15),
    @ExternalId    NVARCHAR(200) = NULL,
    @ErrorMessage  NVARCHAR(500) = NULL,
    @NextAttemptAt DATETIME2(3)  = NULL,
    @CurrentDate   DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ConversationId BIGINT;

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @ConversationId = ConversationId FROM dbo.Inbox_Messages WITH (UPDLOCK) WHERE Id = @Id AND LeaseOwner = @LeaseOwner;

        IF @ConversationId IS NOT NULL
        BEGIN
            -- Si el eco del webhook ya se guardó como otro mensaje, se queda solo este.
            IF @ExternalId IS NOT NULL
                DELETE FROM dbo.Inbox_Messages WHERE ConversationId = @ConversationId AND ExternalId = @ExternalId AND Id <> @Id;

            UPDATE M
            SET StatusCode      = @StatusCode,
                ExternalId      = COALESCE(@ExternalId, M.ExternalId),
                ErrorMessage    = LEFT(@ErrorMessage, 500),
                NextAttemptAt   = @NextAttemptAt,
                LeaseOwner      = NULL,
                LeaseUntil      = NULL,
                SentAt          = IIF(@StatusCode = 'SENT', @CurrentDate, M.SentAt),
                ResponseSeconds = IIF(@StatusCode = 'SENT' AND C.AwaitingSince <= @CurrentDate, DATEDIFF(SECOND, C.AwaitingSince, @CurrentDate), M.ResponseSeconds),
                UpdatedAt       = @CurrentDate
            FROM dbo.Inbox_Messages AS M
            INNER JOIN dbo.Inbox_Conversations AS C ON C.Id = M.ConversationId
            WHERE M.Id = @Id;

            IF @StatusCode = 'SENT'
                UPDATE dbo.Inbox_Conversations
                SET AwaitingSince = NULL,
                    LastMessageAt = IIF(@CurrentDate > LastMessageAt, @CurrentDate, LastMessageAt),
                    UpdatedAt     = @CurrentDate
                WHERE Id = @ConversationId;
        END

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH

    SELECT @ConversationId AS ConversationId;
END
GO

/*
   Ficha del contacto, las demás cuentas de la misma persona (vinculadas a mano o por una invitación), con cuántas
   conversaciones tiene cada una, y las invitaciones de esa persona (las 20 últimas).
*/
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_CONTACT_GET
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Person INT = (SELECT COALESCE(PersonId, Id) FROM dbo.Inbox_Contacts WHERE Id = @Id);

    SELECT Id, Platform, ExternalId, DisplayName, Handle, AvatarUrl, PersonId, Phone, Email, CreatedAt,
           (SELECT COUNT(*) FROM dbo.Inbox_Conversations AS C WHERE C.ContactId = K.Id) AS Conversations,
           (SELECT TOP (1) C.Id FROM dbo.Inbox_Conversations AS C WHERE C.ContactId = K.Id ORDER BY C.LastMessageAt DESC) AS LastConversationId
    FROM dbo.Inbox_Contacts AS K
    WHERE Id = @Id;

    SELECT K.Id, K.Platform, K.ExternalId, K.DisplayName, K.Handle, K.AvatarUrl, K.PersonId, K.Phone, K.Email, K.CreatedAt,
           (SELECT COUNT(*) FROM dbo.Inbox_Conversations AS C WHERE C.ContactId = K.Id) AS Conversations,
           (SELECT TOP (1) C.Id FROM dbo.Inbox_Conversations AS C WHERE C.ContactId = K.Id ORDER BY C.LastMessageAt DESC) AS LastConversationId
    FROM dbo.Inbox_Contacts AS K
    WHERE COALESCE(K.PersonId, K.Id) = @Person AND K.Id <> @Id
    ORDER BY IIF(K.Platform = 'AGENDA', 0, 1), K.Platform, K.DisplayName;

    SELECT TOP (20) I.Id, I.Code, I.ContactId, I.ConnectionId, I.Platform, COALESCE(S.Alias, S.DisplayName) AS AccountName,
           I.Link, I.ExpiresAt, I.UsedAt, I.CreatedBy, I.CreatedAt
    FROM dbo.Inbox_Invites AS I
    INNER JOIN dbo.Inbox_Contacts AS K ON K.Id = I.ContactId
    INNER JOIN dbo.Social_Connections AS S ON S.Id = I.ConnectionId
    WHERE COALESCE(K.PersonId, K.Id) = @Person
    ORDER BY I.CreatedAt DESC, I.Id DESC;
END
GO

/* Buscador de contactos: para vincular la misma persona en otra red y para elegir a quién escribir o invitar. */
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_CONTACT_LIST
    @SearchTerm NVARCHAR(200) = NULL,
    @ExcludeId  INT           = NULL,
    @Take       INT           = 20
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Pattern NVARCHAR(210) =
        IIF(NULLIF(LTRIM(RTRIM(@SearchTerm)), N'') IS NULL, N'%',
            CONCAT(N'%', REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(@SearchTerm)), N'[', N'[[]'), N'%', N'[%]'), N'_', N'[_]'), N'%'));

    SELECT TOP (@Take) Id, Platform, ExternalId, DisplayName, Handle, AvatarUrl, PersonId, Phone, Email, CreatedAt,
           (SELECT COUNT(*) FROM dbo.Inbox_Conversations AS C WHERE C.ContactId = K.Id) AS Conversations,
           CAST(NULL AS BIGINT) AS LastConversationId
    FROM dbo.Inbox_Contacts AS K
    WHERE (DisplayName LIKE @Pattern OR Handle LIKE @Pattern OR Phone LIKE @Pattern OR Email LIKE @Pattern)
      AND (@ExcludeId IS NULL OR Id <> @ExcludeId)
    ORDER BY IIF(Platform = 'AGENDA', 0, 1), DisplayName, Id;
END
GO

/*
   Alta en la agenda: una persona sin cuenta en ninguna red todavía (Platform = 'AGENDA'). El teléfono llega ya
   normalizado (+código país) y no se repite.
*/
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_CONTACT_CREATE
    @DisplayName NVARCHAR(200),
    @Phone       NVARCHAR(30)  = NULL,
    @Email       NVARCHAR(200) = NULL,
    @UserName    NVARCHAR(100),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Existing NVARCHAR(200) = (SELECT TOP (1) DisplayName FROM dbo.Inbox_Contacts WHERE Platform = 'AGENDA' AND Phone = @Phone);
    IF @Existing IS NOT NULL
    BEGIN
        DECLARE @Message NVARCHAR(400) = CONCAT(N'Ya hay un contacto con ese teléfono: ', @Existing, N'. Búscalo en lugar de crearlo otra vez.');
        THROW 50044, @Message, 1;
    END

    INSERT INTO dbo.Inbox_Contacts (Platform, ExternalId, DisplayName, Handle, Phone, Email, CreatedBy, CreatedAt)
    VALUES ('AGENDA', CONVERT(NVARCHAR(200), NEWID()), LEFT(@DisplayName, 200), @Phone, @Phone, @Email, @UserName, @CurrentDate);

    SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id;
END
GO

/*
   Empieza una conversación privada que la persona aún no abrió (WhatsApp: se le escribe por su número con una
   plantilla). Crea o reutiliza la cuenta de la persona en la red y la conversación, y si se indica @PersonContactId
   (la ficha de la agenda) las vincula. Devuelve la conversación.
*/
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_CONVERSATION_START
    @ConnectionId    INT,
    @ExternalId      NVARCHAR(200),
    @DisplayName     NVARCHAR(200),
    @Handle          NVARCHAR(200)  = NULL,
    @PersonContactId INT            = NULL,
    @CurrentDate     DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Platform VARCHAR(20), @ContactId INT, @ConversationId BIGINT;

    SELECT @Platform = Platform FROM dbo.Social_Connections WHERE Id = @ConnectionId AND StatusCode = 'CONNECTED';
    IF @Platform IS NULL
        THROW 50040, N'La cuenta no existe o no está conectada. Revísala en Conexiones.', 1;
    IF @PersonContactId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.Inbox_Contacts WHERE Id = @PersonContactId)
        THROW 50043, N'El contacto no existe. Búscalo de nuevo.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @ContactId = Id
        FROM dbo.Inbox_Contacts WITH (UPDLOCK, HOLDLOCK)
        WHERE Platform = @Platform AND ExternalId = @ExternalId;

        IF @ContactId IS NULL
        BEGIN
            INSERT INTO dbo.Inbox_Contacts (Platform, ExternalId, DisplayName, Handle, CreatedAt)
            VALUES (@Platform, @ExternalId, LEFT(@DisplayName, 200), @Handle, @CurrentDate);
            SET @ContactId = SCOPE_IDENTITY();
        END

        IF @PersonContactId IS NOT NULL AND @PersonContactId <> @ContactId
            EXEC dbo.USP_INBOX_CONTACT_LINK @ContactId = @PersonContactId, @OtherId = @ContactId;

        SELECT @ConversationId = Id
        FROM dbo.Inbox_Conversations WITH (UPDLOCK, HOLDLOCK)
        WHERE ConnectionId = @ConnectionId AND Kind = 'DIRECT' AND ExternalId = @ExternalId;

        IF @ConversationId IS NULL
        BEGIN
            INSERT INTO dbo.Inbox_Conversations (ConnectionId, Kind, ExternalId, ContactId, Title, StatusCode, UnreadCount, LastMessageAt, CreatedAt)
            VALUES (@ConnectionId, 'DIRECT', @ExternalId, @ContactId, LEFT(@DisplayName, 300), 'OPEN', 0, @CurrentDate, @CurrentDate);
            SET @ConversationId = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.Inbox_Conversations
            SET ContactId = COALESCE(ContactId, @ContactId), StatusCode = 'OPEN', UpdatedAt = @CurrentDate
            WHERE Id = @ConversationId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH

    SELECT @ConversationId AS ConversationId;
END
GO

/* Invitación por enlace (Telegram, Messenger, Instagram) para que la persona abra el chat. Devuelve la invitación. */
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_INVITE_CREATE
    @Code         VARCHAR(40),
    @ContactId    INT,
    @ConnectionId INT,
    @Link         NVARCHAR(500),
    @ExpiresAt    DATETIME2(3),
    @UserName     NVARCHAR(100),
    @CurrentDate  DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Platform VARCHAR(20) = (SELECT Platform FROM dbo.Social_Connections WHERE Id = @ConnectionId AND StatusCode = 'CONNECTED');
    IF @Platform IS NULL
        THROW 50040, N'La cuenta no existe o no está conectada. Revísala en Conexiones.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Inbox_Contacts WHERE Id = @ContactId)
        THROW 50043, N'El contacto no existe. Búscalo de nuevo.', 1;

    INSERT INTO dbo.Inbox_Invites (Code, ContactId, ConnectionId, Platform, Link, ExpiresAt, CreatedBy, CreatedAt)
    VALUES (@Code, @ContactId, @ConnectionId, @Platform, @Link, @ExpiresAt, @UserName, @CurrentDate);

    SELECT I.Id, I.Code, I.ContactId, I.ConnectionId, I.Platform, COALESCE(S.Alias, S.DisplayName) AS AccountName,
           I.Link, I.ExpiresAt, I.UsedAt, I.CreatedBy, I.CreatedAt
    FROM dbo.Inbox_Invites AS I
    INNER JOIN dbo.Social_Connections AS S ON S.Id = I.ConnectionId
    WHERE I.Id = SCOPE_IDENTITY();
END
GO

/*
   La persona abrió el chat con un enlace de invitación (Telegram /start, referencia de Messenger o Instagram): su
   cuenta en la red (que se crea si aún no existe) se vincula al contacto de la invitación y la invitación se marca
   usada. Una invitación caducada, ya usada o de otra red no hace nada. Devuelve 1 si se vinculó.
*/
CREATE OR ALTER PROCEDURE dbo.USP_BG_INBOX_INVITE_CLAIM
    @Code              VARCHAR(40),
    @ConnectionId      INT,
    @ContactExternalId NVARCHAR(200),
    @CurrentDate       DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Platform VARCHAR(20) = (SELECT Platform FROM dbo.Social_Connections WHERE Id = @ConnectionId);
    DECLARE @InviteId INT, @PersonContactId INT, @Name NVARCHAR(200), @ContactId INT;

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @InviteId = I.Id, @PersonContactId = I.ContactId, @Name = K.DisplayName
        FROM dbo.Inbox_Invites AS I WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.Inbox_Contacts AS K ON K.Id = I.ContactId
        WHERE I.Code = @Code AND I.Platform = @Platform AND I.UsedAt IS NULL AND I.ExpiresAt > @CurrentDate;

        IF @InviteId IS NOT NULL
        BEGIN
            SELECT @ContactId = Id
            FROM dbo.Inbox_Contacts WITH (UPDLOCK, HOLDLOCK)
            WHERE Platform = @Platform AND ExternalId = @ContactExternalId;

            IF @ContactId IS NULL
            BEGIN
                INSERT INTO dbo.Inbox_Contacts (Platform, ExternalId, DisplayName, CreatedAt)
                VALUES (@Platform, @ContactExternalId, @Name, @CurrentDate);
                SET @ContactId = SCOPE_IDENTITY();
            END

            IF @ContactId <> @PersonContactId
                EXEC dbo.USP_INBOX_CONTACT_LINK @ContactId = @PersonContactId, @OtherId = @ContactId;

            UPDATE dbo.Inbox_Invites SET UsedAt = @CurrentDate, UsedContactId = @ContactId WHERE Id = @InviteId;
        END

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH

    SELECT CAST(IIF(@InviteId IS NULL, 0, 1) AS BIT) AS Claimed;
END
GO

/* Adjuntos de un mensaje recibido con la copia local ya guardada (Inbox:KeepReceivedFiles). */
CREATE OR ALTER PROCEDURE dbo.USP_BG_INBOX_MESSAGE_ATTACHMENTS_SAVE
    @Id          BIGINT,
    @Attachments NVARCHAR(MAX),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Inbox_Messages SET Attachments = @Attachments, UpdatedAt = @CurrentDate WHERE Id = @Id;
END
GO

/*
   Vincula @ContactId con @OtherId (la misma persona en otra red) o, con @OtherId NULL, lo desvincula. El grupo se
   identifica por COALESCE(PersonId, Id): al vincular, todo el grupo de @OtherId pasa al de @ContactId.
*/
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_CONTACT_LINK
    @ContactId INT,
    @OtherId   INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Group INT = (SELECT COALESCE(PersonId, Id) FROM dbo.Inbox_Contacts WHERE Id = @ContactId);
    IF @Group IS NULL
        THROW 50043, N'El contacto no existe. Recarga la conversación.', 1;

    DECLARE @OtherGroup INT = (SELECT COALESCE(PersonId, Id) FROM dbo.Inbox_Contacts WHERE Id = @OtherId);
    IF @OtherId IS NOT NULL AND (@OtherGroup IS NULL OR @OtherId = @ContactId)
        THROW 50043, N'Elige otro contacto para vincular.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF @OtherId IS NOT NULL
            UPDATE dbo.Inbox_Contacts
            SET PersonId = IIF(Id = @Group, NULL, @Group)
            WHERE COALESCE(PersonId, Id) IN (@Group, @OtherGroup);
        ELSE
        BEGIN
            -- Si era el principal del grupo, el siguiente contacto pasa a serlo.
            DECLARE @Next INT = (SELECT MIN(Id) FROM dbo.Inbox_Contacts WHERE PersonId = @ContactId);
            UPDATE dbo.Inbox_Contacts SET PersonId = IIF(Id = @Next, NULL, @Next) WHERE PersonId = @ContactId;
            UPDATE dbo.Inbox_Contacts SET PersonId = NULL WHERE Id = @ContactId;
        END

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/*
   Cuentas que pueden recibir en la bandeja (no quitadas), con sus interruptores y el estado de su consulta periódica.
   SyncKey: Telegram consulta por bot (varios canales comparten bot); el resto, por cuenta.
*/
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_ACCOUNT_LIST
AS
BEGIN
    SET NOCOUNT ON;

    SELECT S.Id, S.Platform, S.ConnectionKey, S.ExternalId, COALESCE(S.Alias, S.DisplayName) AS Name, S.AvatarUrl, S.AccountHint,
           S.StatusCode, S.Scopes, S.CredentialId, Cr.Name AS CredentialName, S.Extra, S.InboxDirect, S.InboxComments, S.IsDefault,
           K.SyncKey, Y.SyncCursor, Y.NextRunAt, Y.LastRunAt, Y.LastOkAt, Y.LastError,
           (SELECT COUNT(*) FROM dbo.Inbox_Conversations AS C WHERE C.ConnectionId = S.Id AND C.StatusCode <> 'CLOSED') AS OpenConversations,
           (SELECT MAX(C.LastInboundAt) FROM dbo.Inbox_Conversations AS C WHERE C.ConnectionId = S.Id) AS LastInboundAt
    FROM dbo.Social_Connections AS S
    LEFT JOIN dbo.Platform_Credentials AS Cr ON Cr.Id = S.CredentialId
    CROSS APPLY (SELECT CAST(IIF(S.Platform = 'TELEGRAM', CONCAT('TELEGRAM-BOT:', S.CredentialId), CONCAT(S.Platform, ':', S.Id)) AS VARCHAR(100)) AS SyncKey) AS K
    LEFT JOIN dbo.Inbox_Sync_State AS Y ON Y.SyncKey = K.SyncKey
    WHERE S.StatusCode IN ('CONNECTED', 'NEEDS_RECONNECT')
    ORDER BY S.Platform, S.IsDefault DESC, COALESCE(S.Alias, S.DisplayName), S.Id;
END
GO

CREATE OR ALTER PROCEDURE dbo.USP_INBOX_ACCOUNT_SETTINGS_SAVE
    @ConnectionId  INT,
    @InboxDirect   BIT,
    @InboxComments BIT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Social_Connections
    SET InboxDirect = @InboxDirect, InboxComments = @InboxComments
    WHERE Id = @ConnectionId AND StatusCode <> 'REVOKED';

    IF @@ROWCOUNT = 0
        THROW 50040, N'La cuenta no existe o se quitó. Recarga la página.', 1;
END
GO

/* Resultado de una consulta periódica: cursor, próxima vuelta y último error. */
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_SYNC_SAVE
    @SyncKey     VARCHAR(100),
    @Cursor      NVARCHAR(1000) = NULL,
    @NextRunAt   DATETIME2(3),
    @IsOk        BIT,
    @Error       NVARCHAR(500)  = NULL,
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Inbox_Sync_State
    SET SyncCursor = @Cursor,
        NextRunAt = @NextRunAt,
        LastRunAt = @CurrentDate,
        LastOkAt  = IIF(@IsOk = 1, @CurrentDate, LastOkAt),
        LastError = IIF(@IsOk = 1, NULL, LEFT(@Error, 500))
    WHERE SyncKey = @SyncKey;

    IF @@ROWCOUNT = 0
        INSERT INTO dbo.Inbox_Sync_State (SyncKey, SyncCursor, NextRunAt, LastRunAt, LastOkAt, LastError)
        VALUES (@SyncKey, @Cursor, @NextRunAt, @CurrentDate, IIF(@IsOk = 1, @CurrentDate, NULL), IIF(@IsOk = 1, NULL, LEFT(@Error, 500)));
END
GO

/* Bandeja en Resultados: recibidos y respondidos por día y por plataforma, con el tiempo medio de respuesta. */
CREATE OR ALTER PROCEDURE dbo.USP_INBOX_STATS
    @From DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT CAST(M.SentAt AS DATE) AS [Day],
           SUM(IIF(M.Direction = 'IN', 1, 0)) AS Received,
           SUM(IIF(M.Direction = 'OUT' AND M.StatusCode IN ('SENT', 'DELIVERED', 'READ'), 1, 0)) AS Sent
    FROM dbo.Inbox_Messages AS M
    WHERE M.SentAt >= @From AND M.Direction IN ('IN', 'OUT')
    GROUP BY CAST(M.SentAt AS DATE)
    ORDER BY [Day];

    SELECT S.Platform,
           SUM(IIF(M.Direction = 'IN', 1, 0)) AS Received,
           SUM(IIF(M.Direction = 'OUT' AND M.StatusCode IN ('SENT', 'DELIVERED', 'READ'), 1, 0)) AS Sent,
           COUNT(DISTINCT IIF(M.Direction = 'IN', M.ConversationId, NULL)) AS Conversations,
           AVG(CAST(M.ResponseSeconds AS FLOAT)) / 60 AS AvgResponseMinutes
    FROM dbo.Inbox_Messages AS M
    INNER JOIN dbo.Inbox_Conversations AS C ON C.Id = M.ConversationId
    INNER JOIN dbo.Social_Connections AS S ON S.Id = C.ConnectionId
    WHERE M.SentAt >= @From AND M.Direction IN ('IN', 'OUT')
    GROUP BY S.Platform
    ORDER BY Received DESC;
END
GO

/*
   Retención: avisos procesados anteriores a @EventsBefore y mensajes anteriores a @MessagesBefore (con sus
   conversaciones vacías y los contactos que ya no se usan). Por lotes para no bloquear.
*/
CREATE OR ALTER PROCEDURE dbo.USP_BG_INBOX_PURGE
    @EventsBefore   DATETIME2(3),
    @MessagesBefore DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Events INT = 0, @Messages INT = 0, @Batch INT = 1;

    WHILE @Batch > 0
    BEGIN
        DELETE TOP (5000) FROM dbo.Inbox_Events WHERE StatusCode = 'DONE' AND ReceivedAt < @EventsBefore;
        SET @Batch = @@ROWCOUNT;
        SET @Events += @Batch;
    END

    SET @Batch = 1;
    WHILE @Batch > 0
    BEGIN
        DELETE TOP (5000) FROM dbo.Inbox_Messages
        WHERE SentAt < @MessagesBefore AND StatusCode NOT IN ('QUEUED', 'SENDING');
        SET @Batch = @@ROWCOUNT;
        SET @Messages += @Batch;
    END

    DELETE C
    FROM dbo.Inbox_Conversations AS C
    WHERE C.LastMessageAt < @MessagesBefore AND NOT EXISTS (SELECT 1 FROM dbo.Inbox_Messages AS M WHERE M.ConversationId = C.Id);

    DELETE FROM dbo.Inbox_Invites WHERE ExpiresAt < @MessagesBefore;

    -- La agenda la da de alta una persona: no caduca sola.
    DELETE K
    FROM dbo.Inbox_Contacts AS K
    WHERE K.CreatedAt < @MessagesBefore AND K.Platform <> 'AGENDA'
      AND NOT EXISTS (SELECT 1 FROM dbo.Inbox_Conversations AS C WHERE C.ContactId = K.Id)
      AND NOT EXISTS (SELECT 1 FROM dbo.Inbox_Contacts AS O WHERE O.PersonId = K.Id);

    SELECT @Events AS Events, @Messages AS Messages;
END
GO

PRINT N'10. Bandeja OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   11. INICIO
   --------------------------------------------------------------------------------------------------------------------- */
/*
   Panel principal: cifras (una fila), agenda (próximas publicaciones y problemas recientes) y actividad de 7 días.
   @DayStart / @DayEnd = el día de hoy del usuario, en UTC. Las conversaciones urgentes salen de USP_INBOX_CONVERSATION_LIST.
*/
CREATE OR ALTER PROCEDURE dbo.USP_HOME_SUMMARY
    @DayStart    DATETIME2(3),
    @DayEnd      DATETIME2(3),
    @CurrentDate DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @WeekStart DATETIME2(3) = DATEADD(DAY, -6, @DayStart);

    SELECT
        (SELECT COUNT(*) FROM dbo.Inbox_Conversations WHERE AwaitingSince IS NOT NULL AND StatusCode <> 'CLOSED') AS Awaiting,
        -- Messenger, Instagram y WhatsApp solo dejan responder 24 h: las que cierran en menos de 6 h.
        (SELECT COUNT(*)
         FROM dbo.Inbox_Conversations AS C
         INNER JOIN dbo.Social_Connections AS S ON S.Id = C.ConnectionId
         WHERE C.AwaitingSince IS NOT NULL AND C.StatusCode <> 'CLOSED' AND C.Kind = 'DIRECT'
           AND S.Platform IN ('FACEBOOK', 'INSTAGRAM', 'WHATSAPP')
           AND C.LastInboundAt BETWEEN DATEADD(HOUR, -24, @CurrentDate) AND DATEADD(HOUR, -18, @CurrentDate)) AS WindowsClosing,
        (SELECT AVG(CAST(ResponseSeconds AS FLOAT)) / 60 FROM dbo.Inbox_Messages
         WHERE Direction = 'OUT' AND ResponseSeconds IS NOT NULL AND SentAt >= DATEADD(DAY, -7, @CurrentDate)) AS AvgResponseMinutes,
        (SELECT AVG(CAST(ResponseSeconds AS FLOAT)) / 60 FROM dbo.Inbox_Messages
         WHERE Direction = 'OUT' AND ResponseSeconds IS NOT NULL
           AND SentAt >= DATEADD(DAY, -14, @CurrentDate) AND SentAt < DATEADD(DAY, -7, @CurrentDate)) AS AvgResponseMinutesPrevious,
        (SELECT COUNT(*) FROM dbo.Publications WHERE StatusCode = 'DONE' AND CompletedAt >= @DayStart AND CompletedAt < @DayEnd) AS PublishedToday,
        (SELECT COUNT(*) FROM dbo.Publications
         WHERE StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA')
           AND PublishAt >= TODATETIMEOFFSET(@CurrentDate, 0) AND PublishAt < TODATETIMEOFFSET(@DayEnd, 0)) AS ScheduledToday,
        (SELECT COUNT(*) FROM dbo.Publications
         WHERE StatusCode IN ('FAILED', 'NEEDS_REVIEW') AND COALESCE(CompletedAt, UpdatedAt, RequestedAt) >= DATEADD(DAY, -7, @CurrentDate)) AS FailedRecent,
        (SELECT COUNT(*) FROM dbo.Social_Connections WHERE StatusCode = 'CONNECTED') AS Connections,
        (SELECT COUNT(*) FROM dbo.Social_Connections
         WHERE StatusCode = 'NEEDS_RECONNECT'
            OR (StatusCode = 'CONNECTED' AND TokenExpiresAt BETWEEN @CurrentDate AND DATEADD(DAY, 7, @CurrentDate))) AS ConnectionsAttention;

    SELECT X.Id, X.VideoId, X.Title, X.Target, X.ConnectionName, X.StatusCode, X.At, X.IsProblem
    FROM
    (
        SELECT TOP (5) P.Id, P.VideoId, P.Title, P.Target, COALESCE(C.Alias, C.DisplayName) AS ConnectionName, P.StatusCode,
               CONVERT(DATETIME2(3), SWITCHOFFSET(P.PublishAt, '+00:00')) AS At, CAST(0 AS BIT) AS IsProblem
        FROM dbo.Publications AS P
        INNER JOIN dbo.Social_Connections AS C ON C.Id = P.ConnectionId
        WHERE P.PublishAt >= TODATETIMEOFFSET(@CurrentDate, 0) AND P.StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA')
        ORDER BY P.PublishAt, P.Id
    ) AS X
    UNION ALL
    SELECT Y.Id, Y.VideoId, Y.Title, Y.Target, Y.ConnectionName, Y.StatusCode, Y.At, Y.IsProblem
    FROM
    (
        SELECT TOP (3) P.Id, P.VideoId, P.Title, P.Target, COALESCE(C.Alias, C.DisplayName) AS ConnectionName, P.StatusCode,
               COALESCE(P.CompletedAt, P.UpdatedAt, P.RequestedAt) AS At, CAST(1 AS BIT) AS IsProblem
        FROM dbo.Publications AS P
        INNER JOIN dbo.Social_Connections AS C ON C.Id = P.ConnectionId
        WHERE P.StatusCode IN ('FAILED', 'NEEDS_REVIEW', 'NEEDS_RECONNECT')
          AND COALESCE(P.CompletedAt, P.UpdatedAt, P.RequestedAt) >= DATEADD(DAY, -7, @CurrentDate)
        ORDER BY COALESCE(P.CompletedAt, P.UpdatedAt, P.RequestedAt) DESC
    ) AS Y
    ORDER BY IsProblem DESC, At;

    SELECT DATEADD(DAY, V.Offset, @WeekStart) AS [Day],
           (SELECT COUNT(*) FROM dbo.Inbox_Messages AS M
            WHERE M.Direction = 'IN' AND M.SentAt >= DATEADD(DAY, V.Offset, @WeekStart) AND M.SentAt < DATEADD(DAY, V.Offset + 1, @WeekStart)) AS Received,
           (SELECT COUNT(*) FROM dbo.Publications AS P
            WHERE P.StatusCode = 'DONE' AND P.CompletedAt >= DATEADD(DAY, V.Offset, @WeekStart) AND P.CompletedAt < DATEADD(DAY, V.Offset + 1, @WeekStart)) AS Published
    FROM (VALUES (0), (1), (2), (3), (4), (5), (6)) AS V (Offset)
    ORDER BY V.Offset;
END
GO

PRINT N'11. Inicio OK.';
GO

PRINT N'Procedimientos listos.';
GO
SET NOEXEC OFF;
GO
