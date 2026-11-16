/* =====================================================================================================================
   YoutubeMeta · 900 · Pruebas en Dev
   Recorre cuentas, cola y claves dentro de una transacción que se deshace al final: no deja datos.
   Ejecutar después de 001 (o 003) y 002. Cada bloque imprime OK o lanza el error.
   ===================================================================================================================== */

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

DECLARE @Now DATETIME2(3) = SYSUTCDATETIME();
DECLARE @VideoId INT, @PostId INT, @TextPostId INT, @LinkedIn INT, @PublicationId BIGINT, @ScheduledId BIGINT, @ChannelA INT, @ChannelB INT, @Telegram INT, @BotId INT,
        @Owner VARCHAR(100) = 'PRUEBAS:1:abcd1234';
DECLARE @Ids TABLE (Id BIGINT);
DECLARE @Saved TABLE (Id INT, IsNew BIT);
DECLARE @Rows TABLE (Affected INT, VideoId INT, Target VARCHAR(20), StatusCode VARCHAR(20));
DECLARE @Count TABLE (Value BIGINT);
DECLARE @Platform TABLE (Platform VARCHAR(20));
DECLARE @Deleted TABLE (Platform VARCHAR(20), SecretCipher NVARCHAR(MAX), CredentialId INT);

-- 1. Video, dos canales de YouTube y un canal de Telegram con su bot
INSERT INTO @Ids EXEC dbo.USP_VIDEO_CREATE @Title = N'Video de prueba', @OriginalFileName = N'prueba.mp4',
    @StoragePath = N'videos/2026/11/prueba.mp4', @ContentType = 'video/mp4', @SizeBytes = 1048576,
    @DurationSec = 12.5, @Width = 1920, @Height = 1080, @UserName = N'pruebas', @CurrentDate = @Now;
SELECT @VideoId = Id FROM @Ids; DELETE FROM @Ids;

DECLARE @MediaJson NVARCHAR(MAX) = CONCAT(N'[{"id":', @VideoId, N'}]');
INSERT INTO @Ids EXEC dbo.USP_POST_CREATE @Kind = 'VIDEO', @Title = N'Video de prueba', @Media = @MediaJson, @UserName = N'pruebas', @CurrentDate = @Now;
SELECT @PostId = Id FROM @Ids; DELETE FROM @Ids;

INSERT INTO @Saved EXEC dbo.USP_CONNECTION_SAVE @Platform = 'YOUTUBE', @ConnectionKey = 'YT-PRUEBA-A', @ExternalId = N'UCpruebaA',
    @DisplayName = N'Canal A', @SecretCipher = N'cifrado', @UserName = N'pruebas', @CurrentDate = @Now;
SELECT @ChannelA = Id FROM @Saved; DELETE FROM @Saved;

INSERT INTO @Saved EXEC dbo.USP_CONNECTION_SAVE @Platform = 'YOUTUBE', @ConnectionKey = 'YT-PRUEBA-B', @ExternalId = N'UCpruebaB',
    @DisplayName = N'Canal B', @SecretCipher = N'cifrado', @UserName = N'pruebas', @CurrentDate = @Now;
SELECT @ChannelB = Id FROM @Saved; DELETE FROM @Saved;

IF (SELECT COUNT(*) FROM dbo.Social_Connections WHERE Id IN (@ChannelA, @ChannelB) AND StatusCode = 'CONNECTED') <> 2
    THROW 50099, N'FALLO: el segundo canal reemplazó al primero.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.Social_Connections WHERE Platform = 'YOUTUBE' AND IsDefault = 1)
    THROW 50099, N'FALLO: YouTube quedó sin cuenta predeterminada.', 1;

INSERT INTO @Ids EXEC dbo.USP_CREDENTIAL_SAVE @Platform = 'TELEGRAM', @Name = N'@prueba_bot', @PublicId = N'123456',
    @SecretCipher = N'cifrado', @Settings = N'{"maxUploadMb":50}', @UserName = N'pruebas', @CurrentDate = @Now;
SELECT @BotId = Id FROM @Ids; DELETE FROM @Ids;

INSERT INTO @Saved EXEC dbo.USP_CONNECTION_SAVE @Platform = 'TELEGRAM', @ConnectionKey = 'TG-PRUEBA', @ExternalId = N'-1001234',
    @DisplayName = N'Canal Telegram', @CredentialId = @BotId, @UserName = N'pruebas', @CurrentDate = @Now;
SELECT @Telegram = Id FROM @Saved; DELETE FROM @Saved;
PRINT N'1. Varias cuentas y bot OK.';

-- 2. Mismo video en dos canales a la vez; Telegram programado lo retiene el job hasta la hora
INSERT INTO @Ids EXEC dbo.USP_PUBLICATION_SAVE @PostId = @PostId, @VideoId = @VideoId, @ConnectionId = @ChannelA, @Title = N'Título', @CategoryId = '26',
    @PrivacyStatus = 'unlisted', @MadeForKids = 0, @ContainsSyntheticMedia = 0, @NotifySubscribers = 1, @UserName = N'pruebas', @CurrentDate = @Now;
SELECT @PublicationId = Id FROM @Ids; DELETE FROM @Ids;

INSERT INTO @Ids EXEC dbo.USP_PUBLICATION_SAVE @PostId = @PostId, @VideoId = @VideoId, @ConnectionId = @ChannelB, @Title = N'Título', @CategoryId = '26',
    @PrivacyStatus = 'public', @MadeForKids = 0, @ContainsSyntheticMedia = 0, @NotifySubscribers = 1, @UserName = N'pruebas', @CurrentDate = @Now;
DELETE FROM @Ids;

DECLARE @Later DATETIMEOFFSET(0) = DATEADD(HOUR, 2, TODATETIMEOFFSET(@Now, 0));
INSERT INTO @Ids EXEC dbo.USP_PUBLICATION_SAVE @PostId = @PostId, @VideoId = @VideoId, @ConnectionId = @Telegram, @Title = N'Título',
    @PrivacyStatus = 'public', @PublishAt = @Later, @MadeForKids = 0, @ContainsSyntheticMedia = 0, @NotifySubscribers = 1,
    @Extra = N'{"disableNotification":true}', @UserName = N'pruebas', @CurrentDate = @Now;
SELECT @ScheduledId = Id FROM @Ids; DELETE FROM @Ids;

IF NOT EXISTS (SELECT 1 FROM dbo.Publications WHERE Id = @ScheduledId AND NextAttemptAt > @Now)
    THROW 50099, N'FALLO: la publicación programada de Telegram no quedó retenida.', 1;
IF NOT EXISTS (SELECT 1 FROM sys.indexes AS I INNER JOIN sys.index_columns AS IC ON IC.object_id = I.object_id AND IC.index_id = I.index_id
               WHERE I.name = N'UX_Publications_Live' AND I.is_unique = 1 AND COL_NAME(IC.object_id, IC.column_id) = N'ConnectionId')
    THROW 50099, N'FALLO: el índice UX_Publications_Live no es por cuenta.', 1;
PRINT N'2. Alta en varias cuentas OK.';

-- 3. Reserva con lease, latido y cierre; el job no toma la publicación programada antes de su hora
EXEC dbo.USP_BG_PUBLICATION_DUE_LIST @Target = 'YOUTUBE', @Top = 1, @LeaseOwner = @Owner, @LeaseMinutes = 10, @CurrentDate = @Now;
IF NOT EXISTS (SELECT 1 FROM dbo.Publications WHERE Id = @PublicationId AND StatusCode = 'UPLOADING' AND LeaseOwner = @Owner)
    THROW 50099, N'FALLO: la fila no quedó reservada.', 1;

EXEC dbo.USP_BG_PUBLICATION_DUE_LIST @Target = 'TELEGRAM', @Top = 5, @LeaseOwner = @Owner, @LeaseMinutes = 10, @CurrentDate = @Now;
IF EXISTS (SELECT 1 FROM dbo.Publications WHERE Id = @ScheduledId AND StatusCode <> 'PENDING')
    THROW 50099, N'FALLO: el job tomó la publicación programada antes de tiempo.', 1;

INSERT INTO @Count EXEC dbo.USP_BG_PUBLICATION_LEASE_EXTEND @Id = @PublicationId, @LeaseOwner = 'OTRO', @LeaseMinutes = 10,
    @BytesSent = 1, @TotalBytes = 2, @Percent = 50, @CurrentDate = @Now;
IF (SELECT Value FROM @Count) <> 0 THROW 50099, N'FALLO: otro dueño renovó el lease.', 1;
DELETE FROM @Count;

INSERT INTO @Rows EXEC dbo.USP_BG_PUBLICATION_RESULT @Id = @PublicationId, @LeaseOwner = @Owner, @StatusCode = 'PROCESSING',
    @ExternalId = N'abc123', @ExternalUrl = N'https://youtu.be/abc123', @ClearSession = 1, @EventMessage = N'Subido.', @CurrentDate = @Now;
IF (SELECT Affected FROM @Rows) <> 1 THROW 50099, N'FALLO: no se cerró el intento.', 1;
DELETE FROM @Rows;
PRINT N'3. Lease, resultado y programación OK.';

-- 4. Reconexión de la misma cuenta: actualiza su fila y la publicación sigue
INSERT INTO @Saved EXEC dbo.USP_CONNECTION_SAVE @Platform = 'YOUTUBE', @ConnectionKey = 'YT-PRUEBA-A2', @ExternalId = N'UCpruebaA',
    @DisplayName = N'Canal A', @SecretCipher = N'cifrado2', @UserName = N'pruebas', @CurrentDate = @Now;
IF NOT EXISTS (SELECT 1 FROM @Saved WHERE Id = @ChannelA AND IsNew = 0) THROW 50099, N'FALLO: la reconexión creó otra fila.', 1;
DELETE FROM @Saved;
IF NOT EXISTS (SELECT 1 FROM dbo.Publications WHERE Id = @PublicationId AND StatusCode = 'PROCESSING')
    THROW 50099, N'FALLO: la reconexión alteró la publicación.', 1;
PRINT N'4. Reconexión OK.';

-- 5. Predeterminada, alias y quitar una cuenta (solo cancela lo suyo y pasa la ★ a otra)
INSERT INTO @Platform EXEC dbo.USP_CONNECTION_DEFAULT_SET @Id = @ChannelB;
INSERT INTO @Platform EXEC dbo.USP_CONNECTION_ALIAS_SAVE @Id = @ChannelB, @Alias = N'  Secundario  ';
IF NOT EXISTS (SELECT 1 FROM dbo.Social_Connections WHERE Id = @ChannelB AND IsDefault = 1 AND Alias = N'Secundario')
    THROW 50099, N'FALLO: no se marcó la predeterminada o el alias.', 1;

INSERT INTO @Deleted EXEC dbo.USP_CONNECTION_DELETE @Id = @ChannelB, @UserName = N'pruebas', @CurrentDate = @Now;
IF NOT EXISTS (SELECT 1 FROM dbo.Social_Connections WHERE Id = @ChannelA AND IsDefault = 1)
    THROW 50099, N'FALLO: al quitar la predeterminada no pasó a la otra cuenta.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.Publications WHERE Id = @PublicationId AND StatusCode = 'PROCESSING')
    THROW 50099, N'FALLO: quitar una cuenta afectó a otra.', 1;
PRINT N'5. Predeterminada, alias y quitar OK.';

-- 6. Cuota por canal: el total suma todos los canales
EXEC dbo.USP_BG_QUOTA_ADD @DayPt = '2000-01-01', @Bucket = 'UPLOADS', @Units = 1, @ConnectionId = @ChannelA;
EXEC dbo.USP_BG_QUOTA_ADD @DayPt = '2000-01-01', @Bucket = 'UPLOADS', @Units = 2, @ConnectionId = @ChannelB;
IF (SELECT SUM(Units) FROM dbo.Youtube_Quota_Usage WHERE DayPt = '2000-01-01' AND Bucket = 'UPLOADS') <> 3
    THROW 50099, N'FALLO: la cuota por canal no suma.', 1;
PRINT N'6. Cuota por canal OK.';

-- 9. Post de solo texto en LinkedIn (sin medio) y primer comentario pendiente
INSERT INTO @Saved EXEC dbo.USP_CONNECTION_SAVE @Platform = 'LINKEDIN', @ConnectionKey = 'LI-PRUEBA', @ExternalId = N'urn:li:person:abc',
    @DisplayName = N'Perfil LinkedIn', @SecretCipher = N'cifrado', @UserName = N'pruebas', @CurrentDate = @Now;
SELECT @LinkedIn = Id FROM @Saved; DELETE FROM @Saved;

INSERT INTO @Ids EXEC dbo.USP_POST_CREATE @Kind = 'TEXT', @Title = N'Solo texto', @UserName = N'pruebas', @CurrentDate = @Now;
SELECT @TextPostId = Id FROM @Ids; DELETE FROM @Ids;

INSERT INTO @Ids EXEC dbo.USP_PUBLICATION_SAVE @PostId = @TextPostId, @ConnectionId = @LinkedIn, @Title = N'Hola LinkedIn',
    @Description = N'Texto del post', @PrivacyStatus = 'connections', @MadeForKids = 0, @ContainsSyntheticMedia = 0, @NotifySubscribers = 1,
    @Extra = N'{"firstComment":"#prueba"}', @UserName = N'pruebas', @CurrentDate = @Now;
DELETE FROM @Ids;

IF NOT EXISTS (SELECT 1 FROM dbo.Publications WHERE PostId = @TextPostId AND VideoId IS NULL AND StatusCode = 'PENDING')
    THROW 50099, N'FALLO: el post de solo texto no quedó en cola.', 1;

EXEC dbo.USP_PUBLICATION_LIST @Platform = 'LINKEDIN', @CurrentDate = @Now;
PRINT N'9. Post de texto en LinkedIn OK.';

-- 7. Listados
EXEC dbo.USP_VIDEO_LIST @Id = @VideoId;
EXEC dbo.USP_PUBLICATION_LIST @VideoId = @VideoId, @CurrentDate = @Now;
EXEC dbo.USP_PUBLICATION_EVENT_LIST @VideoId = @VideoId;
EXEC dbo.USP_CONNECTION_LIST;
EXEC dbo.USP_CREDENTIAL_LIST;
EXEC dbo.USP_QUOTA_GET @DayPt = '2000-01-01';
PRINT N'7. Listados OK.';

ROLLBACK TRANSACTION;
PRINT N'Pruebas terminadas: todo deshecho.';
GO
