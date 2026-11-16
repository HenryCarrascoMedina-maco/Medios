/* =====================================================================================================================
   YoutubeMeta · 004 · Fiabilidad de la cola, revisión de resultados dudosos e índices
   Autor:   Henry Carrasco
   Fecha:   15/11/2026
   Orden:   base existente: (003 si aplica) -> 004 (este) -> 002-procedimientos.sql
            Base nueva: no hace falta (001-esquema.sql ya lo incluye), pero es inofensivo ejecutarlo.
   Requiere: ejecutarse dentro de la base YoutubeMeta (USE YoutubeMeta). Los datos se conservan.

   Qué hace
   1. dbo.Schema_Versions: registro de las migraciones aplicadas.
   2. Video_Publications.CommitStartedAt: marca del paso irreversible; si el proceso muere después, el job
      comprueba en la plataforma antes de volver a subir (evita duplicados).
   3. Estado NEEDS_REVIEW (resultado dudoso que decide una persona): CHECK y el índice único de «una publicación
      viva por (video, cuenta)». Todo en una transacción: si algo falla, la tabla queda como estaba.
   4. Índices: consulta de estado (PROCESSING por NextAttemptAt), FK de los eventos y ruta única de cada video.

   Deshacer: ver el bloque comentado al final (solo si no hay filas en NEEDS_REVIEW).
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
    RAISERROR(N'Ejecuta el script dentro de la base de YoutubeMeta (con 001 o 003 ya aplicados).', 16, 1);
    SET NOEXEC ON;
END
ELSE
    PRINT N'0. Pre-chequeo OK.';
GO

/* 1. Registro de versiones ------------------------------------------------------------------------------------------ */
IF OBJECT_ID(N'dbo.Schema_Versions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Schema_Versions
    (
        Version     VARCHAR(20)   NOT NULL CONSTRAINT PK_Schema_Versions PRIMARY KEY,
        Description NVARCHAR(200) NOT NULL,
        AppliedAt   DATETIME2(3)  NOT NULL CONSTRAINT DF_Schema_Versions_AppliedAt DEFAULT (SYSUTCDATETIME())
    );
    INSERT INTO dbo.Schema_Versions (Version, Description) VALUES ('001', N'Esquema inicial'), ('003', N'Varias cuentas y plataformas');
    PRINT N'1. dbo.Schema_Versions creada.';
END
GO

/* 2 y 3. Columna, estado e índice único, en una transacción -------------------------------------------------------- */
BEGIN TRANSACTION;

IF COL_LENGTH(N'dbo.Video_Publications', N'CommitStartedAt') IS NULL
    ALTER TABLE dbo.Video_Publications ADD CommitStartedAt DATETIME2(3) NULL;

IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = N'CK_Video_Publications_Status' AND definition NOT LIKE N'%NEEDS_REVIEW%')
BEGIN
    ALTER TABLE dbo.Video_Publications DROP CONSTRAINT CK_Video_Publications_Status;
    ALTER TABLE dbo.Video_Publications ADD CONSTRAINT CK_Video_Publications_Status
        CHECK (StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'DONE', 'FAILED', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW', 'CANCELLED'));
END

IF EXISTS (SELECT 1 FROM sys.indexes
           WHERE name = N'UX_Video_Publications_Live' AND object_id = OBJECT_ID(N'dbo.Video_Publications')
             AND filter_definition NOT LIKE N'%NEEDS_REVIEW%')
    DROP INDEX UX_Video_Publications_Live ON dbo.Video_Publications;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Video_Publications_Live' AND object_id = OBJECT_ID(N'dbo.Video_Publications'))
    CREATE UNIQUE INDEX UX_Video_Publications_Live ON dbo.Video_Publications (VideoId, ConnectionId)
        WHERE StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW');

COMMIT TRANSACTION;
PRINT N'2-3. CommitStartedAt, NEEDS_REVIEW e índice único OK.';
GO

/* 4. Índices -------------------------------------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Video_Publications_Poll' AND object_id = OBJECT_ID(N'dbo.Video_Publications'))
    CREATE INDEX IX_Video_Publications_Poll ON dbo.Video_Publications (NextAttemptAt) INCLUDE (LeaseUntil) WHERE StatusCode = 'PROCESSING';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Video_Publication_Events_Publication' AND object_id = OBJECT_ID(N'dbo.Video_Publication_Events'))
    CREATE INDEX IX_Video_Publication_Events_Publication ON dbo.Video_Publication_Events (PublicationId, Id);
GO

-- Un archivo = un video (el alta repetida tras un reciclado devuelve el mismo).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Videos_StoragePath' AND object_id = OBJECT_ID(N'dbo.Videos'))
    CREATE UNIQUE INDEX UX_Videos_StoragePath ON dbo.Videos (StoragePath);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Schema_Versions WHERE Version = '004')
    INSERT INTO dbo.Schema_Versions (Version, Description) VALUES ('004', N'Fiabilidad de la cola, NEEDS_REVIEW e índices');
GO

PRINT N'004 aplicado. Ejecuta ahora 002-procedimientos.sql.';
GO
SET NOEXEC OFF;
GO

/* ---------------------------------------------------------------------------------------------------------------------
   DESHACER 004 (manual; antes, restaurar 002 de la versión anterior):
   BEGIN TRANSACTION;
   IF EXISTS (SELECT 1 FROM dbo.Video_Publications WHERE StatusCode = 'NEEDS_REVIEW') THROW 50000, N'Hay filas en NEEDS_REVIEW.', 1;
   DROP INDEX IF EXISTS IX_Video_Publications_Poll ON dbo.Video_Publications;
   DROP INDEX IF EXISTS IX_Video_Publication_Events_Publication ON dbo.Video_Publication_Events;
   DROP INDEX UX_Video_Publications_Live ON dbo.Video_Publications;
   CREATE UNIQUE INDEX UX_Video_Publications_Live ON dbo.Video_Publications (VideoId, ConnectionId)
       WHERE StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA', 'NEEDS_RECONNECT');
   ALTER TABLE dbo.Video_Publications DROP CONSTRAINT CK_Video_Publications_Status;
   ALTER TABLE dbo.Video_Publications ADD CONSTRAINT CK_Video_Publications_Status
       CHECK (StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'DONE', 'FAILED', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'CANCELLED'));
   ALTER TABLE dbo.Video_Publications DROP COLUMN CommitStartedAt;
   DELETE FROM dbo.Schema_Versions WHERE Version = '004';
   COMMIT TRANSACTION;
   --------------------------------------------------------------------------------------------------------------------- */
