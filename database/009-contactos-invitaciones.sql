/* =====================================================================================================================
   YoutubeMeta · 009 · Agenda de contactos e invitaciones de la bandeja
   Autor:   Henry Carrasco
   Fecha:   16/11/2026
   Orden:   base existente: ... -> 008 -> 009 (este) -> 002-procedimientos.sql
            Base nueva: no hace falta (001-esquema.sql ya lo incluye); ejecutarlo es inofensivo.
   Requiere: el esquema de 008. Idempotente; los datos se conservan.

   Qué hace
   1. Inbox_Contacts: teléfono, correo y quién lo creó. Un contacto de la agenda (Platform = 'AGENDA') es una persona
      que se da de alta a mano, sin cuenta en ninguna red todavía; las cuentas de las redes se vinculan a él (PersonId).
   2. Inbox_Invites: enlaces de invitación (Telegram, Messenger, Instagram) de un solo uso. Cuando la persona abre el
      chat con el enlace, su cuenta en esa red queda vinculada al contacto.
   ===================================================================================================================== */

SET NOCOUNT ON;
SET NOEXEC OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb') OR OBJECT_ID(N'dbo.Inbox_Contacts', N'U') IS NULL
BEGIN
    RAISERROR(N'Ejecuta el script dentro de la base de YoutubeMeta, con 008 ya aplicado.', 16, 1);
    SET NOEXEC ON;
END
ELSE
    PRINT N'0. Pre-chequeo OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   1. INBOX_CONTACTS: teléfono, correo y autor
   --------------------------------------------------------------------------------------------------------------------- */
IF COL_LENGTH(N'dbo.Inbox_Contacts', N'Phone') IS NULL
    ALTER TABLE dbo.Inbox_Contacts ADD Phone NVARCHAR(30) NULL;
GO
IF COL_LENGTH(N'dbo.Inbox_Contacts', N'Email') IS NULL
    ALTER TABLE dbo.Inbox_Contacts ADD Email NVARCHAR(200) NULL;
GO
IF COL_LENGTH(N'dbo.Inbox_Contacts', N'CreatedBy') IS NULL
    ALTER TABLE dbo.Inbox_Contacts ADD CreatedBy NVARCHAR(100) NULL;
GO

-- Un teléfono no se repite en la agenda.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Inbox_Contacts_AgendaPhone' AND object_id = OBJECT_ID(N'dbo.Inbox_Contacts'))
    CREATE UNIQUE INDEX UX_Inbox_Contacts_AgendaPhone ON dbo.Inbox_Contacts (Phone) WHERE Platform = 'AGENDA' AND Phone IS NOT NULL;
GO
PRINT N'1. Inbox_Contacts OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   2. INBOX_INVITES
   --------------------------------------------------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Inbox_Invites', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Inbox_Invites
    (
        Id            INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Inbox_Invites PRIMARY KEY,
        Code          VARCHAR(40)    NOT NULL,   -- va en el enlace (?start= / ?ref=)
        ContactId     INT            NOT NULL CONSTRAINT FK_Inbox_Invites_Contacts REFERENCES dbo.Inbox_Contacts (Id) ON DELETE CASCADE,
        ConnectionId  INT            NOT NULL CONSTRAINT FK_Inbox_Invites_Connections REFERENCES dbo.Social_Connections (Id),
        Platform      VARCHAR(20)    NOT NULL,
        Link          NVARCHAR(500)  NOT NULL,
        ExpiresAt     DATETIME2(3)   NOT NULL,
        UsedAt        DATETIME2(3)   NULL,
        UsedContactId INT            NULL,       -- la cuenta de la red con la que se abrió el chat
        CreatedBy     NVARCHAR(100)  NOT NULL,
        CreatedAt     DATETIME2(3)   NOT NULL,
        CONSTRAINT UQ_Inbox_Invites_Code UNIQUE (Code)
    );
    PRINT N'2. dbo.Inbox_Invites creada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Inbox_Invites_Contact' AND object_id = OBJECT_ID(N'dbo.Inbox_Invites'))
    CREATE INDEX IX_Inbox_Invites_Contact ON dbo.Inbox_Invites (ContactId, CreatedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Schema_Versions WHERE Version = '009')
    INSERT INTO dbo.Schema_Versions (Version, Description) VALUES ('009', N'Agenda de contactos e invitaciones');
GO

PRINT N'009 aplicado. Ejecuta ahora 002-procedimientos.sql.';
GO
SET NOEXEC OFF;
GO
