/* =====================================================================================================================
   YoutubeMeta · 007 · Microsoft Teams
   Autor:   Henry Carrasco
   Fecha:   15/11/2026
   Orden:   base existente: ... -> 006 -> 007 (este) -> 002-procedimientos.sql
            Base nueva: no hace falta (001-esquema.sql ya lo incluye); ejecutarlo es inofensivo.
   Requiere: el esquema de 006 (Media_Assets, Publications). Idempotente; los datos se conservan.

   Qué hace
   1. Plataforma TEAMS en cuentas (Social_Connections), cola (Publications) y claves (Platform_Credentials).
      Cada canal de Teams es una cuenta: ExternalId = «teamId/channelId» (Graph) o «webhook:…» (Workflows).
   ===================================================================================================================== */

SET NOCOUNT ON;
SET NOEXEC OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb') OR OBJECT_ID(N'dbo.Publications', N'U') IS NULL
BEGIN
    RAISERROR(N'Ejecuta el script dentro de la base de YoutubeMeta, con 006 ya aplicado.', 16, 1);
    SET NOEXEC ON;
END
ELSE
    PRINT N'0. Pre-chequeo OK.';
GO

BEGIN TRANSACTION;

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Publications_Target' AND definition NOT LIKE N'%TEAMS%')
    ALTER TABLE dbo.Publications DROP CONSTRAINT CK_Publications_Target;
IF OBJECT_ID(N'dbo.CK_Publications_Target', N'C') IS NULL
    ALTER TABLE dbo.Publications ADD CONSTRAINT CK_Publications_Target
        CHECK (Target IN ('YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK', 'LINKEDIN', 'TEAMS'));

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Social_Connections_Platform' AND definition NOT LIKE N'%TEAMS%')
    ALTER TABLE dbo.Social_Connections DROP CONSTRAINT CK_Social_Connections_Platform;
IF OBJECT_ID(N'dbo.CK_Social_Connections_Platform', N'C') IS NULL
    ALTER TABLE dbo.Social_Connections ADD CONSTRAINT CK_Social_Connections_Platform
        CHECK (Platform IN ('YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK', 'LINKEDIN', 'TEAMS'));

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Platform_Credentials_Platform' AND definition NOT LIKE N'%TEAMS%')
    ALTER TABLE dbo.Platform_Credentials DROP CONSTRAINT CK_Platform_Credentials_Platform;
IF OBJECT_ID(N'dbo.CK_Platform_Credentials_Platform', N'C') IS NULL
    ALTER TABLE dbo.Platform_Credentials ADD CONSTRAINT CK_Platform_Credentials_Platform
        CHECK (Platform IN ('YOUTUBE', 'TIKTOK', 'TELEGRAM', 'LINKEDIN', 'LINKEDIN_ORG', 'TEAMS'));

IF NOT EXISTS (SELECT 1 FROM dbo.Schema_Versions WHERE Version = '007')
    INSERT INTO dbo.Schema_Versions (Version, Description) VALUES ('007', N'Microsoft Teams');

COMMIT TRANSACTION;
PRINT N'007 aplicado. Ejecuta ahora 002-procedimientos.sql.';
GO
SET NOEXEC OFF;
GO
