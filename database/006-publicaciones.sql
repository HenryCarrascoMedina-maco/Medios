/* =====================================================================================================================
   YoutubeMeta · 006 · Publicaciones (texto, enlace, imagen, carrusel, video, PDF) y LinkedIn
   Autor:   Henry Carrasco
   Fecha:   15/11/2026
   Orden:   base existente: (003) -> 004 -> 005 -> 006 (este) -> 002-procedimientos.sql
            Base nueva: no hace falta (001-esquema.sql ya crea el esquema final); ejecutarlo es inofensivo.
   Requiere: ejecutarse dentro de la base YoutubeMeta. Idempotente; los datos se conservan.
   Antes:   haz una copia de seguridad (BACKUP DATABASE YoutubeMeta TO DISK = N'...\YoutubeMeta-antes-006.bak').

   Qué hace (todo en una transacción: si algo falla, la base queda como estaba)
   1. Renombra tablas y sus restricciones e índices:
        Videos                   -> Media_Assets        (la biblioteca guarda videos, imágenes y PDF)
        Video_Publications       -> Publications
        Video_Publication_Events -> Publication_Events
        Video_Tags               -> Media_Tags
      Las columnas VideoId se conservan (son el id del medio principal).
   2. Media_Assets.MediaKind: VIDEO, IMAGE o DOCUMENT (todo lo existente es VIDEO).
   3. Posts y Post_Media: lo que se publica (tipo, enlace) y sus medios en orden.
   4. Publications.PostId (obligatorio), CommentExternalId (primer comentario) y VideoId opcional (un post de solo
      texto no tiene medio). Cada publicación existente recibe un post VIDEO con su video.
   5. «Una publicación viva por (post, cuenta)» sustituye a «por (video, cuenta)».
   6. LinkedIn: plataforma LINKEDIN en cuentas y cola; claves LINKEDIN (perfil) y LINKEDIN_ORG (página de empresa);
      visibilidad «connections» (solo contactos de LinkedIn).
   ===================================================================================================================== */

SET NOCOUNT ON;
SET NOEXEC OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb')
   OR (OBJECT_ID(N'dbo.Video_Publications', N'U') IS NULL AND OBJECT_ID(N'dbo.Publications', N'U') IS NULL)
   OR (OBJECT_ID(N'dbo.Video_Tags', N'U') IS NULL AND OBJECT_ID(N'dbo.Media_Tags', N'U') IS NULL)
BEGIN
    RAISERROR(N'Ejecuta el script dentro de la base de YoutubeMeta, con 004 y 005 ya aplicados.', 16, 1);
    SET NOEXEC ON;
END
ELSE
    PRINT N'0. Pre-chequeo OK.';
GO

BEGIN TRANSACTION;

/* 1. Tablas, restricciones e índices -------------------------------------------------------------------------------- */
DECLARE @Renames TABLE (Seq INT, OldName SYSNAME, NewName SYSNAME);
INSERT INTO @Renames VALUES
    (1, N'Video_Publication_Events', N'Publication_Events'),
    (2, N'Video_Publications', N'Publications'),
    (3, N'Video_Tags', N'Media_Tags'),
    (4, N'Videos', N'Media_Assets');

DECLARE @Old SYSNAME, @New SYSNAME, @Sql NVARCHAR(MAX);
DECLARE TableCursor CURSOR LOCAL FAST_FORWARD FOR SELECT OldName, NewName FROM @Renames ORDER BY Seq;
OPEN TableCursor;
FETCH NEXT FROM TableCursor INTO @Old, @New;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF OBJECT_ID(N'dbo.' + @Old, N'U') IS NOT NULL AND OBJECT_ID(N'dbo.' + @New, N'U') IS NULL
    BEGIN
        SET @Sql = N'dbo.' + @Old;
        EXEC sys.sp_rename @Sql, @New, N'OBJECT';
        PRINT CONCAT(N'1. ', @Old, N' -> ', @New);
    END
    FETCH NEXT FROM TableCursor INTO @Old, @New;
END
CLOSE TableCursor;
DEALLOCATE TableCursor;

-- Restricciones (PK, FK, CHECK, DEFAULT, UNIQUE) e índices que aún llevan el nombre antiguo.
DECLARE @Objects TABLE (Seq INT IDENTITY, Kind CHAR(1), TableName SYSNAME, OldName SYSNAME, NewName SYSNAME);
INSERT INTO @Objects (Kind, TableName, OldName, NewName)
SELECT 'O', OBJECT_NAME(O.parent_object_id), O.name,
       REPLACE(REPLACE(REPLACE(REPLACE(O.name, N'Video_Publication_Events', N'Publication_Events'),
               N'Video_Publications', N'Publications'), N'Video_Tags', N'Media_Tags'), N'Videos', N'Media_Assets')
FROM sys.objects AS O
WHERE O.type IN ('PK', 'F', 'C', 'D', 'UQ') AND O.schema_id = SCHEMA_ID(N'dbo')
  AND (O.name LIKE N'%Video[_]Publication%' OR O.name LIKE N'%Video[_]Tags%' OR O.name LIKE N'%[_]Videos%');

INSERT INTO @Objects (Kind, TableName, OldName, NewName)
SELECT 'I', OBJECT_NAME(I.object_id), I.name,
       REPLACE(REPLACE(REPLACE(REPLACE(I.name, N'Video_Publication_Events', N'Publication_Events'),
               N'Video_Publications', N'Publications'), N'Video_Tags', N'Media_Tags'), N'Videos', N'Media_Assets')
FROM sys.indexes AS I
WHERE I.is_primary_key = 0 AND I.is_unique_constraint = 0 AND I.name IS NOT NULL
  AND OBJECTPROPERTY(I.object_id, 'IsUserTable') = 1
  AND (I.name LIKE N'%Video[_]Publication%' OR I.name LIKE N'%Video[_]Tags%' OR I.name LIKE N'%[_]Videos%');

DECLARE @Kind CHAR(1), @Table SYSNAME;
DECLARE ObjectCursor CURSOR LOCAL FAST_FORWARD FOR SELECT Kind, TableName, OldName, NewName FROM @Objects ORDER BY Seq;
OPEN ObjectCursor;
FETCH NEXT FROM ObjectCursor INTO @Kind, @Table, @Old, @New;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF @Kind = 'O'
    BEGIN
        SET @Sql = N'dbo.' + QUOTENAME(@Old);
        EXEC sys.sp_rename @Sql, @New, N'OBJECT';
    END
    ELSE
    BEGIN
        SET @Sql = N'dbo.' + QUOTENAME(@Table) + N'.' + QUOTENAME(@Old);
        EXEC sys.sp_rename @Sql, @New, N'INDEX';
    END
    FETCH NEXT FROM ObjectCursor INTO @Kind, @Table, @Old, @New;
END
CLOSE ObjectCursor;
DEALLOCATE ObjectCursor;

/* 2. Tipo de medio --------------------------------------------------------------------------------------------------- */
IF COL_LENGTH(N'dbo.Media_Assets', N'MediaKind') IS NULL
BEGIN
    ALTER TABLE dbo.Media_Assets ADD MediaKind VARCHAR(10) NOT NULL CONSTRAINT DF_Media_Assets_MediaKind DEFAULT ('VIDEO')
        CONSTRAINT CK_Media_Assets_MediaKind CHECK (MediaKind IN ('VIDEO', 'IMAGE', 'DOCUMENT'));
    PRINT N'2. Media_Assets.MediaKind añadida.';
END

/* 3. Posts ----------------------------------------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Posts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Posts
    (
        Id        INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Posts PRIMARY KEY,
        Kind      VARCHAR(10)    NOT NULL,
        Title     NVARCHAR(255)  NOT NULL,   -- nombre interno (biblioteca, calendario)
        LinkUrl   NVARCHAR(1000) NULL,
        CreatedBy NVARCHAR(100)  NOT NULL,   -- dueño (multiusuario futuro)
        CreatedAt DATETIME2(3)   NOT NULL,
        CONSTRAINT CK_Posts_Kind CHECK (Kind IN ('TEXT', 'LINK', 'IMAGE', 'CAROUSEL', 'VIDEO', 'DOCUMENT')),
        CONSTRAINT CK_Posts_Link CHECK (Kind <> 'LINK' OR LinkUrl IS NOT NULL)
    );
    PRINT N'3. dbo.Posts creada.';
END

IF OBJECT_ID(N'dbo.Post_Media', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Post_Media
    (
        PostId   INT            NOT NULL CONSTRAINT FK_Post_Media_Posts REFERENCES dbo.Posts (Id),
        Position TINYINT        NOT NULL,
        MediaId  INT            NOT NULL CONSTRAINT FK_Post_Media_Media_Assets REFERENCES dbo.Media_Assets (Id),
        AltText  NVARCHAR(1000) NULL,
        CONSTRAINT PK_Post_Media PRIMARY KEY (PostId, Position)
    );
    CREATE INDEX IX_Post_Media_Media ON dbo.Post_Media (MediaId) INCLUDE (PostId);
    PRINT N'3. dbo.Post_Media creada.';
END

/* 4. Publicaciones: post obligatorio, medio opcional ------------------------------------------------------------- */
IF COL_LENGTH(N'dbo.Publications', N'PostId') IS NULL
    ALTER TABLE dbo.Publications ADD PostId INT NULL CONSTRAINT FK_Publications_Posts REFERENCES dbo.Posts (Id);

IF COL_LENGTH(N'dbo.Publications', N'CommentExternalId') IS NULL
    ALTER TABLE dbo.Publications ADD CommentExternalId NVARCHAR(200) NULL;

-- VideoId pasa a opcional: los índices que lo usan se quitan y se crean de nuevo más abajo.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.Publications') AND name = N'VideoId' AND is_nullable = 0)
BEGIN
    DROP INDEX IF EXISTS UX_Publications_Live ON dbo.Publications;
    DROP INDEX IF EXISTS IX_Publications_Video ON dbo.Publications;
    DROP INDEX IF EXISTS IX_Publications_Schedule ON dbo.Publications;
    ALTER TABLE dbo.Publications ALTER COLUMN VideoId INT NULL;
END

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.Publication_Events') AND name = N'VideoId' AND is_nullable = 0)
BEGIN
    DROP INDEX IF EXISTS IX_Publication_Events_Video ON dbo.Publication_Events;
    ALTER TABLE dbo.Publication_Events ALTER COLUMN VideoId INT NULL;
END
GO

IF @@TRANCOUNT = 0
BEGIN
    RAISERROR(N'Un paso anterior falló y la transacción se deshizo: la base quedó como estaba. Revisa el error de arriba.', 16, 1);
    SET NOEXEC ON;
END
-- Un post VIDEO por cada video que ya tenía publicaciones (en otro lote: las columnas nuevas ya existen).
IF EXISTS (SELECT 1 FROM dbo.Publications WHERE PostId IS NULL)
BEGIN
    DECLARE @Map TABLE (PostId INT, VideoId INT);

    MERGE dbo.Posts AS T
    USING (SELECT V.Id AS VideoId, V.Title, V.CreatedBy, V.CreatedAt
           FROM dbo.Media_Assets AS V
           WHERE EXISTS (SELECT 1 FROM dbo.Publications AS P WHERE P.VideoId = V.Id AND P.PostId IS NULL)) AS S
    ON 1 = 0
    WHEN NOT MATCHED THEN
        INSERT (Kind, Title, CreatedBy, CreatedAt) VALUES ('VIDEO', LEFT(S.Title, 255), S.CreatedBy, S.CreatedAt)
    OUTPUT inserted.Id, S.VideoId INTO @Map (PostId, VideoId);

    INSERT INTO dbo.Post_Media (PostId, Position, MediaId)
    SELECT PostId, 0, VideoId FROM @Map;

    UPDATE P SET PostId = M.PostId
    FROM dbo.Publications AS P
    INNER JOIN @Map AS M ON M.VideoId = P.VideoId
    WHERE P.PostId IS NULL;

    DECLARE @Created INT = (SELECT COUNT(*) FROM @Map);
    PRINT CONCAT(N'4. Posts creados para las publicaciones existentes: ', @Created, N'.');
END
GO

IF @@TRANCOUNT = 0
BEGIN
    RAISERROR(N'Un paso anterior falló y la transacción se deshizo: la base quedó como estaba. Revisa el error de arriba.', 16, 1);
    SET NOEXEC ON;
END
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.Publications') AND name = N'PostId' AND is_nullable = 1)
    ALTER TABLE dbo.Publications ALTER COLUMN PostId INT NOT NULL;
GO

IF @@TRANCOUNT = 0
BEGIN
    RAISERROR(N'Un paso anterior falló y la transacción se deshizo: la base quedó como estaba. Revisa el error de arriba.', 16, 1);
    SET NOEXEC ON;
END
/* 5. Índices -------------------------------------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Publications_Live' AND object_id = OBJECT_ID(N'dbo.Publications'))
    CREATE UNIQUE INDEX UX_Publications_Live ON dbo.Publications (PostId, ConnectionId)
        WHERE StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publications_Video' AND object_id = OBJECT_ID(N'dbo.Publications'))
    CREATE INDEX IX_Publications_Video ON dbo.Publications (VideoId, ConnectionId, Id DESC) INCLUDE (Target, StatusCode, [Percent], ExternalUrl);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publications_Post' AND object_id = OBJECT_ID(N'dbo.Publications'))
    CREATE INDEX IX_Publications_Post ON dbo.Publications (PostId, ConnectionId, Id DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publications_Schedule' AND object_id = OBJECT_ID(N'dbo.Publications'))
    CREATE INDEX IX_Publications_Schedule ON dbo.Publications (PublishAt) INCLUDE (VideoId, ConnectionId, Target, StatusCode)
        WHERE PublishAt IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publication_Events_Video' AND object_id = OBJECT_ID(N'dbo.Publication_Events'))
    CREATE INDEX IX_Publication_Events_Video ON dbo.Publication_Events (VideoId, Id);
GO

IF @@TRANCOUNT = 0
BEGIN
    RAISERROR(N'Un paso anterior falló y la transacción se deshizo: la base quedó como estaba. Revisa el error de arriba.', 16, 1);
    SET NOEXEC ON;
END
/* 6. LinkedIn y visibilidad «connections» -------------------------------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Publications_Target' AND definition NOT LIKE N'%LINKEDIN%')
    ALTER TABLE dbo.Publications DROP CONSTRAINT CK_Publications_Target;
IF OBJECT_ID(N'dbo.CK_Publications_Target', N'C') IS NULL
    ALTER TABLE dbo.Publications ADD CONSTRAINT CK_Publications_Target
        CHECK (Target IN ('YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK', 'LINKEDIN'));

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Publications_Privacy' AND definition NOT LIKE N'%connections%')
    ALTER TABLE dbo.Publications DROP CONSTRAINT CK_Publications_Privacy;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.Publications') AND name = N'PrivacyStatus' AND max_length < 20)
BEGIN
    IF OBJECT_ID(N'dbo.CK_Publications_Privacy', N'C') IS NOT NULL
        ALTER TABLE dbo.Publications DROP CONSTRAINT CK_Publications_Privacy;
    IF OBJECT_ID(N'dbo.CK_Publications_Schedule', N'C') IS NOT NULL
        ALTER TABLE dbo.Publications DROP CONSTRAINT CK_Publications_Schedule;
    ALTER TABLE dbo.Publications ALTER COLUMN PrivacyStatus VARCHAR(20) NOT NULL;
    ALTER TABLE dbo.Publications ADD CONSTRAINT CK_Publications_Schedule CHECK (PublishAt IS NULL OR Target <> 'YOUTUBE' OR PrivacyStatus = 'private');
END
IF OBJECT_ID(N'dbo.CK_Publications_Privacy', N'C') IS NULL
    ALTER TABLE dbo.Publications ADD CONSTRAINT CK_Publications_Privacy
        CHECK (PrivacyStatus IN ('public', 'unlisted', 'private', 'followers', 'friends', 'connections'));

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Social_Connections_Platform' AND definition NOT LIKE N'%LINKEDIN%')
    ALTER TABLE dbo.Social_Connections DROP CONSTRAINT CK_Social_Connections_Platform;
IF OBJECT_ID(N'dbo.CK_Social_Connections_Platform', N'C') IS NULL
    ALTER TABLE dbo.Social_Connections ADD CONSTRAINT CK_Social_Connections_Platform
        CHECK (Platform IN ('YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK', 'LINKEDIN'));

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Platform_Credentials_Platform' AND definition NOT LIKE N'%LINKEDIN_ORG%')
    ALTER TABLE dbo.Platform_Credentials DROP CONSTRAINT CK_Platform_Credentials_Platform;
IF OBJECT_ID(N'dbo.CK_Platform_Credentials_Platform', N'C') IS NULL
    ALTER TABLE dbo.Platform_Credentials ADD CONSTRAINT CK_Platform_Credentials_Platform
        CHECK (Platform IN ('YOUTUBE', 'TIKTOK', 'TELEGRAM', 'LINKEDIN', 'LINKEDIN_ORG'));
GO

IF @@TRANCOUNT = 0
BEGIN
    RAISERROR(N'Un paso anterior falló y la transacción se deshizo: la base quedó como estaba. Revisa el error de arriba.', 16, 1);
    SET NOEXEC ON;
END
IF NOT EXISTS (SELECT 1 FROM dbo.Schema_Versions WHERE Version = '006')
    INSERT INTO dbo.Schema_Versions (Version, Description) VALUES ('006', N'Publicaciones con varios medios y LinkedIn');
GO

IF @@TRANCOUNT = 0
BEGIN
    RAISERROR(N'Un paso anterior falló y la transacción se deshizo: la base quedó como estaba. Revisa el error de arriba.', 16, 1);
    SET NOEXEC ON;
END
COMMIT TRANSACTION;
PRINT N'006 aplicado. Ejecuta ahora 002-procedimientos.sql.';
GO
SET NOEXEC OFF;
GO
