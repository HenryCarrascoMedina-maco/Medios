/* =====================================================================================================================
   YoutubeMeta · 000 · Crear la base (opcional)
   Ejecutar conectado a master. Si la base ya existe no hace nada.
   Después: USE YoutubeMeta; 001-esquema.sql; 002-procedimientos.sql
   ===================================================================================================================== */

IF DB_ID(N'YoutubeMeta') IS NULL
BEGIN
    CREATE DATABASE YoutubeMeta;
    PRINT N'Base YoutubeMeta creada.';
END
ELSE
    PRINT N'La base YoutubeMeta ya existe.';
GO
