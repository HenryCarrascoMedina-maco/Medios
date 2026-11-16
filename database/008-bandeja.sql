/* =====================================================================================================================
   YoutubeMeta · 008 · Bandeja unificada (mensajes y comentarios), WhatsApp y panel de inicio
   Autor:   Henry Carrasco
   Fecha:   16/11/2026
   Orden:   base existente: ... -> 007 -> 008 (este) -> 002-procedimientos.sql
            Base nueva: no hace falta (001-esquema.sql ya lo incluye); ejecutarlo es inofensivo.
   Requiere: el esquema de 007. Idempotente; los datos se conservan.

   Qué hace
   1. Plataforma WHATSAPP en cuentas (Social_Connections): solo bandeja, no publica.
      Clave META en Platform_Credentials: App ID + App Secret de la app de Meta (firma de los webhooks).
   2. Social_Connections: Extra (JSON propio de la plataforma; WhatsApp = id de la cuenta de WhatsApp Business) e
      interruptores de la bandeja por cuenta (InboxDirect = mensajes privados, InboxComments = comentarios).
   3. Tablas de la bandeja:
        Inbox_Contacts             personas que escriben (por plataforma). PersonId agrupa la misma persona en varias
                                   redes; siempre se vincula a mano.
        Inbox_Conversations        una conversación privada, un grupo o los comentarios de una publicación.
                                   AwaitingSince = primer mensaje entrante sin responder (para «Sin responder» y el
                                   tiempo de respuesta).
        Inbox_Conversation_Tags    etiquetas de la conversación.
        Inbox_Messages             entrantes, salientes (cola del job con lease, como Publications) y notas internas.
        Inbox_Events               entrada en crudo de los webhooks y de las consultas, idempotente (Platform, EventKey).
        Inbox_Sync_State           cursor de las consultas periódicas (YouTube, Telegram sin webhook, Teams).
        Inbox_Quick_Replies        respuestas rápidas (/atajo).
   ===================================================================================================================== */

SET NOCOUNT ON;
SET NOEXEC OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb') OR OBJECT_ID(N'dbo.Publications', N'U') IS NULL
BEGIN
    RAISERROR(N'Ejecuta el script dentro de la base de YoutubeMeta, con 007 ya aplicado.', 16, 1);
    SET NOEXEC ON;
END
ELSE
    PRINT N'0. Pre-chequeo OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   1. PLATAFORMAS: WHATSAPP (cuentas) y META (clave de la app)
   --------------------------------------------------------------------------------------------------------------------- */
BEGIN TRANSACTION;

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Social_Connections_Platform' AND definition NOT LIKE N'%WHATSAPP%')
    ALTER TABLE dbo.Social_Connections DROP CONSTRAINT CK_Social_Connections_Platform;
IF OBJECT_ID(N'dbo.CK_Social_Connections_Platform', N'C') IS NULL
    ALTER TABLE dbo.Social_Connections ADD CONSTRAINT CK_Social_Connections_Platform
        CHECK (Platform IN ('YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK', 'LINKEDIN', 'TEAMS', 'WHATSAPP'));

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Platform_Credentials_Platform' AND definition NOT LIKE N'%META%')
    ALTER TABLE dbo.Platform_Credentials DROP CONSTRAINT CK_Platform_Credentials_Platform;
IF OBJECT_ID(N'dbo.CK_Platform_Credentials_Platform', N'C') IS NULL
    ALTER TABLE dbo.Platform_Credentials ADD CONSTRAINT CK_Platform_Credentials_Platform
        CHECK (Platform IN ('YOUTUBE', 'TIKTOK', 'TELEGRAM', 'LINKEDIN', 'LINKEDIN_ORG', 'TEAMS', 'META'));

COMMIT TRANSACTION;
PRINT N'1. Plataformas WHATSAPP y META OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   2. SOCIAL_CONNECTIONS: Extra e interruptores de la bandeja
   --------------------------------------------------------------------------------------------------------------------- */
IF COL_LENGTH(N'dbo.Social_Connections', N'Extra') IS NULL
    ALTER TABLE dbo.Social_Connections ADD Extra NVARCHAR(MAX) NULL
        CONSTRAINT CK_Social_Connections_Extra CHECK (Extra IS NULL OR ISJSON(Extra) = 1);
GO
IF COL_LENGTH(N'dbo.Social_Connections', N'InboxDirect') IS NULL
    ALTER TABLE dbo.Social_Connections ADD InboxDirect BIT NOT NULL CONSTRAINT DF_Social_Connections_InboxDirect DEFAULT (1);
GO
IF COL_LENGTH(N'dbo.Social_Connections', N'InboxComments') IS NULL
    ALTER TABLE dbo.Social_Connections ADD InboxComments BIT NOT NULL CONSTRAINT DF_Social_Connections_InboxComments DEFAULT (1);
GO
PRINT N'2. Social_Connections OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   3. TABLAS DE LA BANDEJA
   --------------------------------------------------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Inbox_Contacts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Inbox_Contacts
    (
        Id          INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Inbox_Contacts PRIMARY KEY,
        Platform    VARCHAR(20)    NOT NULL,
        ExternalId  NVARCHAR(200)  NOT NULL,   -- PSID, IGSID, wa_id, id de usuario de Telegram o de Microsoft
        DisplayName NVARCHAR(200)  NOT NULL,
        Handle      NVARCHAR(200)  NULL,       -- @usuario o teléfono
        AvatarUrl   NVARCHAR(1000) NULL,
        PersonId    INT            NULL,       -- contacto principal de la misma persona (vinculado a mano)
        CreatedAt   DATETIME2(3)   NOT NULL,
        UpdatedAt   DATETIME2(3)   NULL,
        CONSTRAINT UQ_Inbox_Contacts_External UNIQUE (Platform, ExternalId)
    );
    PRINT N'3. dbo.Inbox_Contacts creada.';
END
GO

IF OBJECT_ID(N'dbo.Inbox_Conversations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Inbox_Conversations
    (
        Id                 BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Inbox_Conversations PRIMARY KEY,
        ConnectionId       INT            NOT NULL CONSTRAINT FK_Inbox_Conversations_Connections REFERENCES dbo.Social_Connections (Id),
        Kind               VARCHAR(10)    NOT NULL,   -- DIRECT, COMMENTS, GROUP
        ExternalId         NVARCHAR(200)  NOT NULL,   -- PSID / IGSID / wa_id / chat_id / id del post o video
        ContactId          INT            NULL CONSTRAINT FK_Inbox_Conversations_Contacts REFERENCES dbo.Inbox_Contacts (Id),
        PublicationId      BIGINT         NULL CONSTRAINT FK_Inbox_Conversations_Publications REFERENCES dbo.Publications (Id),
        Title              NVARCHAR(300)  NOT NULL,
        Link               NVARCHAR(500)  NULL,       -- enlace a la publicación o al chat en la plataforma
        StatusCode         VARCHAR(10)    NOT NULL CONSTRAINT DF_Inbox_Conversations_Status DEFAULT ('OPEN'),
        UnreadCount        INT            NOT NULL CONSTRAINT DF_Inbox_Conversations_Unread DEFAULT (0),
        LastMessageAt      DATETIME2(3)   NOT NULL,
        LastMessagePreview NVARCHAR(200)  NULL,
        LastInboundAt      DATETIME2(3)   NULL,       -- abre la ventana de 24 h de Messenger, Instagram y WhatsApp
        AwaitingSince      DATETIME2(3)   NULL,       -- primer entrante sin responder
        AssignedTo         NVARCHAR(100)  NULL,
        CreatedAt          DATETIME2(3)   NOT NULL,
        UpdatedAt          DATETIME2(3)   NULL,
        CONSTRAINT UQ_Inbox_Conversations_External UNIQUE (ConnectionId, Kind, ExternalId),
        CONSTRAINT CK_Inbox_Conversations_Kind CHECK (Kind IN ('DIRECT', 'COMMENTS', 'GROUP')),
        CONSTRAINT CK_Inbox_Conversations_Status CHECK (StatusCode IN ('OPEN', 'PENDING', 'CLOSED')),
        CONSTRAINT CK_Inbox_Conversations_Unread CHECK (UnreadCount >= 0)
    );
    PRINT N'3. dbo.Inbox_Conversations creada.';
END
GO

IF OBJECT_ID(N'dbo.Inbox_Conversation_Tags', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Inbox_Conversation_Tags
    (
        ConversationId BIGINT       NOT NULL CONSTRAINT FK_Inbox_Conversation_Tags_Conversations REFERENCES dbo.Inbox_Conversations (Id) ON DELETE CASCADE,
        Tag            NVARCHAR(50) NOT NULL,
        CONSTRAINT PK_Inbox_Conversation_Tags PRIMARY KEY (ConversationId, Tag)
    );
    PRINT N'3. dbo.Inbox_Conversation_Tags creada.';
END
GO

IF OBJECT_ID(N'dbo.Inbox_Messages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Inbox_Messages
    (
        Id               BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Inbox_Messages PRIMARY KEY,
        ConversationId   BIGINT         NOT NULL CONSTRAINT FK_Inbox_Messages_Conversations REFERENCES dbo.Inbox_Conversations (Id) ON DELETE CASCADE,
        ExternalId       NVARCHAR(200)  NULL,       -- id en la plataforma (NULL en notas y en salientes aún sin enviar)
        ParentExternalId NVARCHAR(200)  NULL,       -- comentario al que responde
        Direction        VARCHAR(4)     NOT NULL,   -- IN, OUT, NOTE
        AuthorName       NVARCHAR(200)  NULL,
        AuthorExternalId NVARCHAR(200)  NULL,
        Body             NVARCHAR(MAX)  NULL,
        Attachments      NVARCHAR(MAX)  NULL,       -- JSON [{ kind, name, url, mediaId, contentType }]
        Options          NVARCHAR(MAX)  NULL,       -- JSON del envío: respuesta privada, plantilla, medios de la biblioteca
        SentAt           DATETIME2(3)   NOT NULL,
        StatusCode       VARCHAR(15)    NOT NULL,
        ErrorMessage     NVARCHAR(500)  NULL,
        Attempts         INT            NOT NULL CONSTRAINT DF_Inbox_Messages_Attempts DEFAULT (0),
        NextAttemptAt    DATETIME2(3)   NULL,
        LeaseOwner       VARCHAR(100)   NULL,
        LeaseUntil       DATETIME2(3)   NULL,
        ResponseSeconds  INT            NULL,       -- salientes: segundos desde el primer entrante sin responder
        CreatedBy        NVARCHAR(100)  NULL,
        CreatedAt        DATETIME2(3)   NOT NULL,
        UpdatedAt        DATETIME2(3)   NULL,
        CONSTRAINT CK_Inbox_Messages_Direction CHECK (Direction IN ('IN', 'OUT', 'NOTE')),
        CONSTRAINT CK_Inbox_Messages_Status CHECK (StatusCode IN ('RECEIVED', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'NEEDS_REVIEW', 'CANCELLED')),
        CONSTRAINT CK_Inbox_Messages_Attachments CHECK (Attachments IS NULL OR ISJSON(Attachments) = 1),
        CONSTRAINT CK_Inbox_Messages_Options CHECK (Options IS NULL OR ISJSON(Options) = 1)
    );
    PRINT N'3. dbo.Inbox_Messages creada.';
END
GO

IF OBJECT_ID(N'dbo.Inbox_Events', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Inbox_Events
    (
        Id            BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Inbox_Events PRIMARY KEY,
        Platform      VARCHAR(20)    NOT NULL,
        EventKey      NVARCHAR(200)  NOT NULL,   -- id del aviso (Telegram: bot:update_id; Meta: hash de la entrada)
        Payload       NVARCHAR(MAX)  NOT NULL,
        StatusCode    VARCHAR(10)    NOT NULL,   -- PENDING, DONE, FAILED
        Attempts      INT            NOT NULL CONSTRAINT DF_Inbox_Events_Attempts DEFAULT (0),
        NextAttemptAt DATETIME2(3)   NULL,
        LeaseOwner    VARCHAR(100)   NULL,
        LeaseUntil    DATETIME2(3)   NULL,
        ErrorMessage  NVARCHAR(500)  NULL,
        ReceivedAt    DATETIME2(3)   NOT NULL,
        ProcessedAt   DATETIME2(3)   NULL,
        CONSTRAINT UQ_Inbox_Events_Key UNIQUE (Platform, EventKey),
        CONSTRAINT CK_Inbox_Events_Status CHECK (StatusCode IN ('PENDING', 'DONE', 'FAILED')),
        CONSTRAINT CK_Inbox_Events_Payload CHECK (ISJSON(Payload) = 1)
    );
    PRINT N'3. dbo.Inbox_Events creada.';
END
GO

IF OBJECT_ID(N'dbo.Inbox_Sync_State', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Inbox_Sync_State
    (
        SyncKey   VARCHAR(100)   NOT NULL CONSTRAINT PK_Inbox_Sync_State PRIMARY KEY,   -- YOUTUBE:12, TELEGRAM-BOT:3…
        SyncCursor NVARCHAR(1000) NULL,
        NextRunAt DATETIME2(3)   NULL,
        LastRunAt DATETIME2(3)   NULL,
        LastOkAt  DATETIME2(3)   NULL,
        LastError NVARCHAR(500)  NULL
    );
    PRINT N'3. dbo.Inbox_Sync_State creada.';
END
GO

IF OBJECT_ID(N'dbo.Inbox_Quick_Replies', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Inbox_Quick_Replies
    (
        Id        INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Inbox_Quick_Replies PRIMARY KEY,
        Shortcut  NVARCHAR(40)   NOT NULL,
        Body      NVARCHAR(2000) NOT NULL,
        CreatedBy NVARCHAR(100)  NOT NULL,
        CreatedAt DATETIME2(3)   NOT NULL,
        UpdatedBy NVARCHAR(100)  NULL,
        UpdatedAt DATETIME2(3)   NULL,
        CONSTRAINT UQ_Inbox_Quick_Replies_Shortcut UNIQUE (Shortcut)
    );
    PRINT N'3. dbo.Inbox_Quick_Replies creada.';
END
GO

/* ---------------------------------------------------------------------------------------------------------------------
   4. ÍNDICES
   --------------------------------------------------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Inbox_Conversations_List' AND object_id = OBJECT_ID(N'dbo.Inbox_Conversations'))
    CREATE INDEX IX_Inbox_Conversations_List ON dbo.Inbox_Conversations (StatusCode, LastMessageAt DESC, Id DESC)
        INCLUDE (ConnectionId, Kind, UnreadCount, AwaitingSince);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Inbox_Conversations_Awaiting' AND object_id = OBJECT_ID(N'dbo.Inbox_Conversations'))
    CREATE INDEX IX_Inbox_Conversations_Awaiting ON dbo.Inbox_Conversations (AwaitingSince)
        INCLUDE (ConnectionId, StatusCode, LastInboundAt) WHERE AwaitingSince IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Inbox_Conversations_Contact' AND object_id = OBJECT_ID(N'dbo.Inbox_Conversations'))
    CREATE INDEX IX_Inbox_Conversations_Contact ON dbo.Inbox_Conversations (ContactId) WHERE ContactId IS NOT NULL;
GO

-- Un mismo mensaje de la plataforma no se guarda dos veces en la conversación.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Inbox_Messages_External' AND object_id = OBJECT_ID(N'dbo.Inbox_Messages'))
    CREATE UNIQUE INDEX UX_Inbox_Messages_External ON dbo.Inbox_Messages (ConversationId, ExternalId) WHERE ExternalId IS NOT NULL;
GO

-- Acuses de entrega y lectura (llegan solo con el id del mensaje).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Inbox_Messages_ExternalId' AND object_id = OBJECT_ID(N'dbo.Inbox_Messages'))
    CREATE INDEX IX_Inbox_Messages_ExternalId ON dbo.Inbox_Messages (ExternalId) WHERE ExternalId IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Inbox_Messages_Conversation' AND object_id = OBJECT_ID(N'dbo.Inbox_Messages'))
    CREATE INDEX IX_Inbox_Messages_Conversation ON dbo.Inbox_Messages (ConversationId, Id DESC);
GO

-- Cola de envío (USP_BG_INBOX_SEND_DUE_LIST).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Inbox_Messages_Send' AND object_id = OBJECT_ID(N'dbo.Inbox_Messages'))
    CREATE INDEX IX_Inbox_Messages_Send ON dbo.Inbox_Messages (StatusCode, NextAttemptAt) INCLUDE (LeaseUntil)
        WHERE Direction = 'OUT' AND StatusCode IN ('QUEUED', 'SENDING');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Inbox_Messages_Sent' AND object_id = OBJECT_ID(N'dbo.Inbox_Messages'))
    CREATE INDEX IX_Inbox_Messages_Sent ON dbo.Inbox_Messages (SentAt) INCLUDE (ConversationId, Direction, ResponseSeconds);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Inbox_Events_Due' AND object_id = OBJECT_ID(N'dbo.Inbox_Events'))
    CREATE INDEX IX_Inbox_Events_Due ON dbo.Inbox_Events (StatusCode, NextAttemptAt) INCLUDE (LeaseUntil) WHERE StatusCode IN ('PENDING', 'FAILED');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Inbox_Events_Received' AND object_id = OBJECT_ID(N'dbo.Inbox_Events'))
    CREATE INDEX IX_Inbox_Events_Received ON dbo.Inbox_Events (Platform, ReceivedAt) INCLUDE (StatusCode);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Schema_Versions WHERE Version = '008')
    INSERT INTO dbo.Schema_Versions (Version, Description) VALUES ('008', N'Bandeja unificada, WhatsApp y panel de inicio');
GO

PRINT N'008 aplicado. Ejecuta ahora 002-procedimientos.sql.';
GO
SET NOEXEC OFF;
GO
