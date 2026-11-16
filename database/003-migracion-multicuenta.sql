/* =====================================================================================================================
   YoutubeMeta · 003 · Migración a varias cuentas y nuevas plataformas
   Autor:   Henry Carrasco
   Fecha:   13/11/2026
   Orden:   base existente (creada con el 001 anterior) -> 003 (este) -> 002-procedimientos (volver a ejecutarlo)
            En una base nueva no hace falta: 001 ya crea el esquema final y este script no cambia nada.
   Requiere: ejecutarse dentro de la base YoutubeMeta (USE YoutubeMeta).

   Qué hace
   1. Platform_Credentials: tabla nueva para las claves de Google, TikTok y los bots de Telegram.
   2. Social_Connections: columnas Alias y CredentialId; admite INSTAGRAM, TELEGRAM y TIKTOK.
   3. Video_Publications: columna Extra (opciones por plataforma), destinos y privacidades nuevas, y la
      programación ya no es exclusiva de Facebook.
   4. Youtube_Quota_Usage: columna ConnectionId en la clave (desglose por canal).
   5. Índices: una publicación viva por (video, cuenta) en vez de (video, plataforma); una sola fila activa
      por cuenta; un mismo bot no se guarda dos veces.

   Los datos existentes no cambian: la cuenta conectada sigue siendo la predeterminada de su plataforma.
   Idempotente: se puede volver a ejecutar.
   ===================================================================================================================== */

SET NOCOUNT ON;
SET NOEXEC OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------------------------------------------------------------------------------------------------------------------
   0. PRE-CHEQUEO
   --------------------------------------------------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Social_Connections', N'U') IS NULL OR OBJECT_ID(N'dbo.Video_Publications', N'U') IS NULL
BEGIN
    RAISERROR(N'No es una base de YoutubeMeta: en una base nueva ejecuta 001-esquema.sql y 002-procedimientos.sql.', 16, 1);
    SET NOEXEC ON;
END
ELSE
    PRINT N'0. Pre-chequeo OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   1. PLATFORM_CREDENTIALS
   --------------------------------------------------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Platform_Credentials', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Platform_Credentials
    (
        Id           INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Platform_Credentials PRIMARY KEY,
        Platform     VARCHAR(20)    NOT NULL,
        Name         NVARCHAR(100)  NOT NULL,
        PublicId     NVARCHAR(300)  NULL,
        SecretCipher NVARCHAR(MAX)  NOT NULL,
        Settings     NVARCHAR(MAX)  NULL,
        StatusCode   VARCHAR(20)    NOT NULL,
        CreatedBy    NVARCHAR(100)  NOT NULL,
        CreatedAt    DATETIME2(3)   NOT NULL,
        UpdatedBy    NVARCHAR(100)  NULL,
        UpdatedAt    DATETIME2(3)   NULL,
        CONSTRAINT CK_Platform_Credentials_Platform CHECK (Platform IN ('YOUTUBE', 'TIKTOK', 'TELEGRAM')),
        CONSTRAINT CK_Platform_Credentials_StatusCode CHECK (StatusCode IN ('ACTIVE', 'DELETED')),
        CONSTRAINT CK_Platform_Credentials_Settings CHECK (Settings IS NULL OR ISJSON(Settings) = 1)
    );
    PRINT N'1. dbo.Platform_Credentials creada.';
END
ELSE
    PRINT N'1. dbo.Platform_Credentials ya existía.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   2. SOCIAL_CONNECTIONS
   --------------------------------------------------------------------------------------------------------------------- */
IF COL_LENGTH(N'dbo.Social_Connections', N'Alias') IS NULL
    ALTER TABLE dbo.Social_Connections ADD Alias NVARCHAR(100) NULL;
GO

IF COL_LENGTH(N'dbo.Social_Connections', N'CredentialId') IS NULL
    ALTER TABLE dbo.Social_Connections ADD CredentialId INT NULL
        CONSTRAINT FK_Social_Connections_Credentials REFERENCES dbo.Platform_Credentials (Id);
GO

ALTER TABLE dbo.Social_Connections DROP CONSTRAINT IF EXISTS CK_Social_Connections_Platform;
ALTER TABLE dbo.Social_Connections ADD CONSTRAINT CK_Social_Connections_Platform
    CHECK (Platform IN ('YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK'));
PRINT N'2. dbo.Social_Connections actualizada.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   3. VIDEO_PUBLICATIONS
   --------------------------------------------------------------------------------------------------------------------- */
IF COL_LENGTH(N'dbo.Video_Publications', N'Extra') IS NULL
    ALTER TABLE dbo.Video_Publications ADD Extra NVARCHAR(MAX) NULL;
GO

ALTER TABLE dbo.Video_Publications DROP CONSTRAINT IF EXISTS CK_Video_Publications_Target;
ALTER TABLE dbo.Video_Publications DROP CONSTRAINT IF EXISTS CK_Video_Publications_Privacy;
ALTER TABLE dbo.Video_Publications DROP CONSTRAINT IF EXISTS CK_Video_Publications_Schedule;
ALTER TABLE dbo.Video_Publications DROP CONSTRAINT IF EXISTS CK_Video_Publications_Extra;

ALTER TABLE dbo.Video_Publications ADD
    CONSTRAINT CK_Video_Publications_Target CHECK (Target IN ('YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK')),
    CONSTRAINT CK_Video_Publications_Privacy CHECK (PrivacyStatus IN ('public', 'unlisted', 'private', 'followers', 'friends')),
    CONSTRAINT CK_Video_Publications_Schedule CHECK (PublishAt IS NULL OR Target <> 'YOUTUBE' OR PrivacyStatus = 'private'),
    CONSTRAINT CK_Video_Publications_Extra CHECK (Extra IS NULL OR ISJSON(Extra) = 1);
PRINT N'3. dbo.Video_Publications actualizada.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   4. YOUTUBE_QUOTA_USAGE (ConnectionId en la clave)
   --------------------------------------------------------------------------------------------------------------------- */
IF COL_LENGTH(N'dbo.Youtube_Quota_Usage', N'ConnectionId') IS NULL
BEGIN
    ALTER TABLE dbo.Youtube_Quota_Usage ADD ConnectionId INT NOT NULL
        CONSTRAINT DF_Youtube_Quota_Usage_Connection DEFAULT (0);
    PRINT N'4. Columna ConnectionId añadida.';
END
GO

IF NOT EXISTS (SELECT 1
               FROM sys.index_columns AS IC
               INNER JOIN sys.indexes AS I ON I.object_id = IC.object_id AND I.index_id = IC.index_id
               WHERE I.object_id = OBJECT_ID(N'dbo.Youtube_Quota_Usage') AND I.is_primary_key = 1
                 AND COL_NAME(IC.object_id, IC.column_id) = N'ConnectionId')
BEGIN
    ALTER TABLE dbo.Youtube_Quota_Usage DROP CONSTRAINT PK_Youtube_Quota_Usage;
    ALTER TABLE dbo.Youtube_Quota_Usage ADD CONSTRAINT PK_Youtube_Quota_Usage PRIMARY KEY (DayPt, Bucket, ConnectionId);
    PRINT N'4. Clave de dbo.Youtube_Quota_Usage actualizada.';
END
GO

/* ---------------------------------------------------------------------------------------------------------------------
   5. ÍNDICES
   --------------------------------------------------------------------------------------------------------------------- */

-- Antes era (VideoId, Target): ahora un mismo video puede ir a varias cuentas de la misma plataforma.
IF EXISTS (SELECT 1
           FROM sys.index_columns AS IC
           INNER JOIN sys.indexes AS I ON I.object_id = IC.object_id AND I.index_id = IC.index_id
           WHERE I.name = N'UX_Video_Publications_Live' AND I.object_id = OBJECT_ID(N'dbo.Video_Publications')
             AND COL_NAME(IC.object_id, IC.column_id) = N'Target')
    DROP INDEX UX_Video_Publications_Live ON dbo.Video_Publications;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Video_Publications_Live' AND object_id = OBJECT_ID(N'dbo.Video_Publications'))
    CREATE UNIQUE INDEX UX_Video_Publications_Live ON dbo.Video_Publications (VideoId, ConnectionId)
        WHERE StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA', 'NEEDS_RECONNECT');
GO

IF EXISTS (SELECT 1
           FROM sys.index_columns AS IC
           INNER JOIN sys.indexes AS I ON I.object_id = IC.object_id AND I.index_id = IC.index_id
           WHERE I.name = N'IX_Video_Publications_Video' AND I.object_id = OBJECT_ID(N'dbo.Video_Publications')
             AND IC.key_ordinal = 2 AND COL_NAME(IC.object_id, IC.column_id) = N'Target')
    DROP INDEX IX_Video_Publications_Video ON dbo.Video_Publications;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Video_Publications_Video' AND object_id = OBJECT_ID(N'dbo.Video_Publications'))
    CREATE INDEX IX_Video_Publications_Video ON dbo.Video_Publications (VideoId, ConnectionId, Id DESC) INCLUDE (Target, StatusCode, [Percent], ExternalUrl);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Social_Connections_Account' AND object_id = OBJECT_ID(N'dbo.Social_Connections'))
    CREATE UNIQUE INDEX UX_Social_Connections_Account ON dbo.Social_Connections (Platform, ExternalId)
        WHERE StatusCode IN ('CONNECTED', 'NEEDS_RECONNECT');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Platform_Credentials_Public' AND object_id = OBJECT_ID(N'dbo.Platform_Credentials'))
    CREATE UNIQUE INDEX UX_Platform_Credentials_Public ON dbo.Platform_Credentials (Platform, PublicId)
        WHERE StatusCode = 'ACTIVE' AND PublicId IS NOT NULL;
GO

PRINT N'5. Índices OK. Migración lista: vuelve a ejecutar 002-procedimientos.sql.';
GO
SET NOEXEC OFF;
GO
