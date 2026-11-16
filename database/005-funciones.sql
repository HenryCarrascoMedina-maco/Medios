/* =====================================================================================================================
   YoutubeMeta · 005 · Etiquetas, plantillas, firmas y métricas
   Autor:   Henry Carrasco
   Fecha:   15/11/2026
   Orden:   base nueva: 001 -> 005 (este) -> 002.  Base existente: (003) -> 004 -> 005 (este) -> 002.
   Requiere: ejecutarse dentro de la base YoutubeMeta. Idempotente; los datos se conservan.

   Qué hace
   1. Video_Tags             etiquetas libres de la biblioteca (#tutoriales, #promo…) para filtrar y agrupar.
   2. Publication_Templates  plantillas de título, descripción y etiquetas con variables ({titulo}, {fecha},
                             {firma_cuenta}, #bloque:nombre). Las resuelve el front al publicar.
   3. Hashtag_Blocks         bloques de hashtags reutilizables (#bloque:cocina).
   4. Social_Connections.Signature  firma por cuenta ({firma_cuenta}).
   5. Publication_Metrics    vistas, «me gusta» y comentarios de lo publicado (los recoge un job diario).
   ===================================================================================================================== */

SET NOCOUNT ON;
SET NOEXEC OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.Media_Assets', N'U') IS NOT NULL
BEGIN
    PRINT N'La base ya tiene el esquema de 006 (o es nueva con 001): este script no hace falta. Nada que hacer.';
    SET NOEXEC ON;
END
ELSE
IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb') OR OBJECT_ID(N'dbo.Video_Publications', N'U') IS NULL
BEGIN
    RAISERROR(N'Ejecuta el script dentro de la base de YoutubeMeta (con 001 o 003/004 ya aplicados).', 16, 1);
    SET NOEXEC ON;
END
ELSE
    PRINT N'0. Pre-chequeo OK.';
GO

IF OBJECT_ID(N'dbo.Video_Tags', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Video_Tags
    (
        VideoId INT          NOT NULL CONSTRAINT FK_Video_Tags_Videos REFERENCES dbo.Videos (Id),
        Tag     NVARCHAR(50) NOT NULL,
        CONSTRAINT PK_Video_Tags PRIMARY KEY (VideoId, Tag)
    );
    CREATE INDEX IX_Video_Tags_Tag ON dbo.Video_Tags (Tag) INCLUDE (VideoId);
    PRINT N'1. dbo.Video_Tags creada.';
END
GO

IF OBJECT_ID(N'dbo.Publication_Templates', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Publication_Templates
    (
        Id          INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Publication_Templates PRIMARY KEY,
        Name        NVARCHAR(100) NOT NULL,
        Title       NVARCHAR(255) NOT NULL,
        Description NVARCHAR(MAX) NULL,
        Tags        NVARCHAR(600) NULL,
        IsDefault   BIT           NOT NULL CONSTRAINT DF_Publication_Templates_IsDefault DEFAULT (0),
        CreatedBy   NVARCHAR(100) NOT NULL,
        CreatedAt   DATETIME2(3)  NOT NULL,
        UpdatedBy   NVARCHAR(100) NULL,
        UpdatedAt   DATETIME2(3)  NULL,
        CONSTRAINT UQ_Publication_Templates_Name UNIQUE (Name)
    );
    CREATE UNIQUE INDEX UX_Publication_Templates_Default ON dbo.Publication_Templates (IsDefault) WHERE IsDefault = 1;
    PRINT N'2. dbo.Publication_Templates creada.';
END
GO

IF OBJECT_ID(N'dbo.Hashtag_Blocks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Hashtag_Blocks
    (
        Id        INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Hashtag_Blocks PRIMARY KEY,
        Name      NVARCHAR(50)   NOT NULL,   -- se usa como #bloque:nombre
        Content   NVARCHAR(1000) NOT NULL,
        CreatedBy NVARCHAR(100)  NOT NULL,
        CreatedAt DATETIME2(3)   NOT NULL,
        UpdatedAt DATETIME2(3)   NULL,
        CONSTRAINT UQ_Hashtag_Blocks_Name UNIQUE (Name)
    );
    PRINT N'3. dbo.Hashtag_Blocks creada.';
END
GO

IF COL_LENGTH(N'dbo.Social_Connections', N'Signature') IS NULL
BEGIN
    ALTER TABLE dbo.Social_Connections ADD Signature NVARCHAR(1000) NULL;
    PRINT N'4. Social_Connections.Signature añadida.';
END
GO

IF OBJECT_ID(N'dbo.Publication_Metrics', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Publication_Metrics
    (
        PublicationId BIGINT       NOT NULL CONSTRAINT PK_Publication_Metrics PRIMARY KEY
                                   CONSTRAINT FK_Publication_Metrics_Publications REFERENCES dbo.Video_Publications (Id),
        Views         BIGINT       NULL,
        Likes         BIGINT       NULL,
        Comments      BIGINT       NULL,
        CollectedAt   DATETIME2(3) NOT NULL
    );
    PRINT N'5. dbo.Publication_Metrics creada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Video_Publications_Schedule' AND object_id = OBJECT_ID(N'dbo.Video_Publications'))
    CREATE INDEX IX_Video_Publications_Schedule ON dbo.Video_Publications (PublishAt) INCLUDE (VideoId, ConnectionId, Target, StatusCode)
        WHERE PublishAt IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Video_Publications_Completed' AND object_id = OBJECT_ID(N'dbo.Video_Publications'))
    CREATE INDEX IX_Video_Publications_Completed ON dbo.Video_Publications (CompletedAt) INCLUDE (ConnectionId, Target, StatusCode, RequestedAt)
        WHERE CompletedAt IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.Schema_Versions', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.Schema_Versions WHERE Version = '005')
    INSERT INTO dbo.Schema_Versions (Version, Description) VALUES ('005', N'Etiquetas, plantillas, firmas y métricas');
GO

PRINT N'005 aplicado. Ejecuta ahora 002-procedimientos.sql.';
GO
SET NOEXEC OFF;
GO
