/* =====================================================================================================================
   YoutubeMeta · 999 · Rollback
   Elimina procedimientos, funciones y tablas de 001 a 010. BORRA LOS DATOS (medios, publicaciones, cola, conexiones,
   conversaciones de la bandeja).
   Los archivos de Storage:Root no se tocan.
   ===================================================================================================================== */

SET NOCOUNT ON;
GO

DECLARE @Procedures TABLE (Name SYSNAME);
-- Todos los procedimientos de la app (USP_*), también los que se añadan en el futuro.
INSERT INTO @Procedures (Name)
SELECT name FROM sys.procedures WHERE schema_id = SCHEMA_ID(N'dbo') AND name LIKE N'USP[_]%';

DECLARE @Sql NVARCHAR(MAX) = N'';
SELECT @Sql += CONCAT(N'DROP PROCEDURE IF EXISTS dbo.', QUOTENAME(Name), N';', CHAR(10)) FROM @Procedures;
EXEC sys.sp_executesql @Sql;
DROP FUNCTION IF EXISTS dbo.UFN_PLATFORM_LABEL;
DROP FUNCTION IF EXISTS dbo.UFN_PUBLICATION_START;
PRINT N'Procedimientos y funciones eliminados.';
GO

DROP TABLE IF EXISTS dbo.Inbox_Conversation_Tags;
DROP TABLE IF EXISTS dbo.Inbox_Messages;
DROP TABLE IF EXISTS dbo.Inbox_Conversations;
DROP TABLE IF EXISTS dbo.Inbox_Invites;
DROP TABLE IF EXISTS dbo.Inbox_Contacts;
DROP TABLE IF EXISTS dbo.Inbox_Events;
DROP TABLE IF EXISTS dbo.Inbox_Sync_State;
DROP TABLE IF EXISTS dbo.Inbox_Quick_Replies;
DROP TABLE IF EXISTS dbo.Template_Media;
DROP TABLE IF EXISTS dbo.Templates;
DROP TABLE IF EXISTS dbo.Publication_Metrics;
DROP TABLE IF EXISTS dbo.Media_Tags;
DROP TABLE IF EXISTS dbo.Video_Tags;
DROP TABLE IF EXISTS dbo.Publication_Templates;
DROP TABLE IF EXISTS dbo.Hashtag_Blocks;
DROP TABLE IF EXISTS dbo.Schema_Versions;
DROP TABLE IF EXISTS dbo.Publication_Events;
DROP TABLE IF EXISTS dbo.Video_Publication_Events;
DROP TABLE IF EXISTS dbo.Publications;
DROP TABLE IF EXISTS dbo.Video_Publications;
DROP TABLE IF EXISTS dbo.Post_Media;
DROP TABLE IF EXISTS dbo.Posts;
DROP TABLE IF EXISTS dbo.Social_Connections;
DROP TABLE IF EXISTS dbo.Platform_Credentials;
DROP TABLE IF EXISTS dbo.Youtube_Quota_Usage;
DROP TABLE IF EXISTS dbo.Media_Assets;
DROP TABLE IF EXISTS dbo.Videos;
PRINT N'Tablas eliminadas.';
GO
