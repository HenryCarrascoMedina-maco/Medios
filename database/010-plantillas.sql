/* =====================================================================================================================
   YoutubeMeta · 010 · Plantillas propias con etiquetas y adjuntos
   Autor:   Henry Carrasco
   Fecha:   16/11/2026
   Orden:   base existente: ... -> 009 -> 010 (este) -> 002-procedimientos.sql
            Base nueva: no hace falta (001-esquema.sql ya lo incluye); ejecutarlo es inofensivo.
   Requiere: el esquema de 008. Idempotente; los datos se conservan.

   Qué hace
   1. Templates: una sola tabla para las plantillas de publicación (Usage = 'PUBLISH') y las respuestas de la bandeja
      (Usage = 'REPLY', con /atajo). El texto va en Body con etiquetas ({titulo}, {nombre}, {?campo}, #bloque:x).
   2. Template_Media: adjuntos de la biblioteca en orden (misma forma que Post_Media).
   3. Copia Publication_Templates (Description -> Body) e Inbox_Quick_Replies (Name = Shortcut) y borra las dos.
   ===================================================================================================================== */

SET NOCOUNT ON;
SET NOEXEC OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb') OR OBJECT_ID(N'dbo.Media_Assets', N'U') IS NULL
BEGIN
    RAISERROR(N'Ejecuta el script dentro de la base de YoutubeMeta, con 008 ya aplicado.', 16, 1);
    SET NOEXEC ON;
END
ELSE
    PRINT N'0. Pre-chequeo OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   1. TEMPLATES
   --------------------------------------------------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Templates', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Templates
    (
        Id         INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Templates PRIMARY KEY,
        Usage      VARCHAR(10)    NOT NULL,
        Name       NVARCHAR(100)  NOT NULL,
        Shortcut   NVARCHAR(40)   NULL,   -- solo REPLY: se escribe /atajo en la bandeja
        Title      NVARCHAR(255)  NULL,   -- solo PUBLISH
        Body       NVARCHAR(MAX)  NULL,
        Tags       NVARCHAR(600)  NULL,   -- etiquetas de YouTube (solo PUBLISH)
        Platforms  VARCHAR(200)   NULL,   -- redes donde se ofrece, separadas por comas; NULL = todas
        IsDefault  BIT            NOT NULL CONSTRAINT DF_Templates_IsDefault DEFAULT (0),
        UseCount   INT            NOT NULL CONSTRAINT DF_Templates_UseCount DEFAULT (0),
        LastUsedAt DATETIME2(3)   NULL,
        CreatedBy  NVARCHAR(100)  NOT NULL,
        CreatedAt  DATETIME2(3)   NOT NULL,
        UpdatedBy  NVARCHAR(100)  NULL,
        UpdatedAt  DATETIME2(3)   NULL,
        CONSTRAINT CK_Templates_Usage CHECK (Usage IN ('PUBLISH', 'REPLY')),
        CONSTRAINT CK_Templates_Shortcut CHECK ((Usage = 'REPLY' AND Shortcut IS NOT NULL) OR (Usage = 'PUBLISH' AND Shortcut IS NULL)),
        CONSTRAINT CK_Templates_Default CHECK (IsDefault = 0 OR Usage = 'PUBLISH'),
        CONSTRAINT UQ_Templates_Name UNIQUE (Usage, Name)
    );
    CREATE UNIQUE INDEX UX_Templates_Shortcut ON dbo.Templates (Shortcut) WHERE Shortcut IS NOT NULL;
    CREATE UNIQUE INDEX UX_Templates_Default ON dbo.Templates (Usage) WHERE IsDefault = 1;
    PRINT N'1. dbo.Templates creada.';
END
GO

/* ---------------------------------------------------------------------------------------------------------------------
   2. TEMPLATE_MEDIA
   --------------------------------------------------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Template_Media', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Template_Media
    (
        TemplateId INT            NOT NULL CONSTRAINT FK_Template_Media_Templates REFERENCES dbo.Templates (Id) ON DELETE CASCADE,
        Position   TINYINT        NOT NULL,
        MediaId    INT            NOT NULL CONSTRAINT FK_Template_Media_Media_Assets REFERENCES dbo.Media_Assets (Id),
        AltText    NVARCHAR(1000) NULL,
        CONSTRAINT PK_Template_Media PRIMARY KEY (TemplateId, Position)
    );
    CREATE INDEX IX_Template_Media_Media ON dbo.Template_Media (MediaId);
    PRINT N'2. dbo.Template_Media creada.';
END
GO

/* ---------------------------------------------------------------------------------------------------------------------
   3. MIGRACIÓN DE LAS TABLAS ANTERIORES
   --------------------------------------------------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Publication_Templates', N'U') IS NOT NULL
BEGIN
    EXEC sys.sp_executesql N'
        INSERT INTO dbo.Templates (Usage, Name, Title, Body, Tags, IsDefault, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt)
        SELECT ''PUBLISH'', P.Name, P.Title, P.Description, P.Tags, P.IsDefault, P.CreatedBy, P.CreatedAt, P.UpdatedBy, P.UpdatedAt
        FROM dbo.Publication_Templates AS P
        WHERE NOT EXISTS (SELECT 1 FROM dbo.Templates AS T WHERE T.Usage = ''PUBLISH'' AND T.Name = P.Name);';
    DROP TABLE dbo.Publication_Templates;
    PRINT N'3. Publication_Templates copiada a Templates y eliminada.';
END
GO

IF OBJECT_ID(N'dbo.Inbox_Quick_Replies', N'U') IS NOT NULL
BEGIN
    EXEC sys.sp_executesql N'
        INSERT INTO dbo.Templates (Usage, Name, Shortcut, Body, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt)
        SELECT ''REPLY'', Q.Shortcut, Q.Shortcut, Q.Body, Q.CreatedBy, Q.CreatedAt, Q.UpdatedBy, Q.UpdatedAt
        FROM dbo.Inbox_Quick_Replies AS Q
        WHERE NOT EXISTS (SELECT 1 FROM dbo.Templates AS T WHERE T.Shortcut = Q.Shortcut);';
    DROP TABLE dbo.Inbox_Quick_Replies;
    PRINT N'3. Inbox_Quick_Replies copiada a Templates y eliminada.';
END
GO

DROP PROCEDURE IF EXISTS dbo.USP_INBOX_QUICK_REPLY_LIST;
DROP PROCEDURE IF EXISTS dbo.USP_INBOX_QUICK_REPLY_SAVE;
DROP PROCEDURE IF EXISTS dbo.USP_INBOX_QUICK_REPLY_DELETE;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Schema_Versions WHERE Version = '010')
    INSERT INTO dbo.Schema_Versions (Version, Description) VALUES ('010', N'Plantillas propias con etiquetas y adjuntos');
GO

PRINT N'010 aplicado. Ejecuta ahora 002-procedimientos.sql.';
GO
SET NOEXEC OFF;
GO
