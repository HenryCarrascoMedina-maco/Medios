/* =====================================================================================================================
   YoutubeMeta · 001 · Esquema
   Autor:   Henry Carrasco
   Fecha:   12/11/2026
   Orden:   000 (crear base, opcional) -> 001 (este) -> 002-procedimientos
            Base existente: 003 (antes del 13/11/2026), 004 y 005 (antes del 15/11/2026), 006, 007, 008, 009, 010 y luego 002.
   Requiere: ejecutarse dentro de la base YoutubeMeta (USE YoutubeMeta).

   Qué hace
   1. Tablas:
        Media_Assets                   biblioteca de medios: videos, imágenes y PDF (rutas relativas a Storage:Root).
                                       Baja lógica: StatusCode DELETED.
        Posts, Post_Media              lo que se publica (texto, enlace, imagen, carrusel, video, PDF) y sus medios.
        Platform_Credentials           claves de cada plataforma (cliente OAuth de Google y de TikTok, bots de
                                       Telegram), cifradas con AES-GCM desde la API.
        Social_Connections             cuentas de destino, varias por plataforma (YouTube, Facebook, Instagram,
                                       Telegram, TikTok, LinkedIn, Teams y WhatsApp, que solo es de la bandeja).
                                       IsDefault = la preseleccionada al publicar. Token cifrado. InboxDirect e
                                       InboxComments = qué recibe la bandeja de esa cuenta.
        Publications                   cola del job (lease LeaseOwner / LeaseUntil). Una publicación viva por
                                       (post, cuenta). VideoId = medio principal (vacío en posts de solo texto).
        Publication_Events             historial del detalle y campana de avisos (IsNotification).
        Youtube_Quota_Usage            unidades de cuota de YouTube por día del Pacífico y canal. La cuota es del
                                       proyecto de Google: el límite se aplica a la suma de todos los canales.
        Media_Tags, Hashtag_Blocks, Publication_Metrics: etiquetas, bloques de hashtags y métricas.
        Templates, Template_Media      plantillas propias (de publicación y respuestas de la bandeja) con etiquetas y
                                       adjuntos de la biblioteca (ver 010-plantillas.sql).
        Inbox_Contacts, Inbox_Conversations, Inbox_Conversation_Tags, Inbox_Messages, Inbox_Events,
        Inbox_Sync_State               bandeja unificada (ver 008-bandeja.sql).
        Inbox_Invites                  agenda e invitaciones por enlace (ver 009-contactos-invitaciones.sql).
        Schema_Versions                migraciones aplicadas.
   2. Índices de la cola, de la campana y de unicidad.

   Estados de Publications: PENDING, UPLOADING, PROCESSING, DONE, FAILED, WAITING_QUOTA, NEEDS_RECONNECT,
   NEEDS_REVIEW (resultado dudoso que decide una persona), CANCELLED. Fechas en UTC (DATETIME2). Idempotente: se puede volver a ejecutar.
   ===================================================================================================================== */

SET NOCOUNT ON;
SET NOEXEC OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------------------------------------------------------------------------------------------------------------------
   0. PRE-CHEQUEO
   --------------------------------------------------------------------------------------------------------------------- */
IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb')
BEGIN
    RAISERROR(N'Ejecuta el script dentro de la base de YoutubeMeta (USE YoutubeMeta).', 16, 1);
    SET NOEXEC ON;
END
ELSE
    PRINT N'0. Pre-chequeo OK.';
GO

/* ---------------------------------------------------------------------------------------------------------------------
   1. TABLAS
   --------------------------------------------------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Media_Assets', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Media_Assets
    (
        Id               INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Media_Assets PRIMARY KEY,
        Title            NVARCHAR(200)  NOT NULL,
        OriginalFileName NVARCHAR(260)  NOT NULL,
        StoragePath      NVARCHAR(400)  NOT NULL,
        PosterPath       NVARCHAR(400)  NULL,
        ContentType      VARCHAR(100)   NOT NULL,
        SizeBytes        BIGINT         NOT NULL,
        DurationSec      DECIMAL(10, 3) NULL,
        Width            INT            NULL,
        Height           INT            NULL,
        StatusCode       VARCHAR(20)    NOT NULL CONSTRAINT DF_Media_Assets_StatusCode DEFAULT ('READY'),
        CreatedBy        NVARCHAR(100)  NOT NULL,
        CreatedAt        DATETIME2(3)   NOT NULL,
        UpdatedBy        NVARCHAR(100)  NULL,
        UpdatedAt        DATETIME2(3)   NULL,
        MediaKind        VARCHAR(10)    NOT NULL CONSTRAINT DF_Media_Assets_MediaKind DEFAULT ('VIDEO'),
        CONSTRAINT CK_Media_Assets_StatusCode CHECK (StatusCode IN ('READY', 'DELETED')),
        CONSTRAINT CK_Media_Assets_MediaKind CHECK (MediaKind IN ('VIDEO', 'IMAGE', 'DOCUMENT')),
        CONSTRAINT CK_Media_Assets_SizeBytes CHECK (SizeBytes > 0)
    );
    PRINT N'1. dbo.Media_Assets creada.';
END
GO

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
    PRINT N'1. dbo.Posts creada.';
END
GO

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
    PRINT N'1. dbo.Post_Media creada.';
END
GO

IF OBJECT_ID(N'dbo.Platform_Credentials', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Platform_Credentials
    (
        Id           INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Platform_Credentials PRIMARY KEY,
        Platform     VARCHAR(20)    NOT NULL,
        Name         NVARCHAR(100)  NOT NULL,   -- «Cliente OAuth» o @usuario del bot
        PublicId     NVARCHAR(300)  NULL,       -- Client ID de Google, client_key de TikTok o id del bot
        SecretCipher NVARCHAR(MAX)  NOT NULL,   -- secreto del cliente o token del bot (AES-GCM)
        Settings     NVARCHAR(MAX)  NULL,       -- JSON. Telegram: { "apiBaseUrl": "...", "maxUploadMb": 50 }
        StatusCode   VARCHAR(20)    NOT NULL,
        CreatedBy    NVARCHAR(100)  NOT NULL,
        CreatedAt    DATETIME2(3)   NOT NULL,
        UpdatedBy    NVARCHAR(100)  NULL,
        UpdatedAt    DATETIME2(3)   NULL,
        CONSTRAINT CK_Platform_Credentials_Platform CHECK (Platform IN ('YOUTUBE', 'TIKTOK', 'TELEGRAM', 'LINKEDIN', 'LINKEDIN_ORG', 'TEAMS', 'META')),
        CONSTRAINT CK_Platform_Credentials_StatusCode CHECK (StatusCode IN ('ACTIVE', 'DELETED')),
        CONSTRAINT CK_Platform_Credentials_Settings CHECK (Settings IS NULL OR ISJSON(Settings) = 1)
    );
    PRINT N'1. dbo.Platform_Credentials creada.';
END
GO

IF OBJECT_ID(N'dbo.Social_Connections', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Social_Connections
    (
        Id              INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Social_Connections PRIMARY KEY,
        Platform        VARCHAR(20)    NOT NULL,
        ConnectionKey   VARCHAR(50)    NOT NULL,   -- clave del IDataStore de Google / referencia interna
        ExternalId      NVARCHAR(100)  NOT NULL,   -- channelId (UC…), pageId, id de Instagram, chat_id u open_id
        DisplayName     NVARCHAR(200)  NOT NULL,
        Alias           NVARCHAR(100)  NULL,       -- nombre corto opcional que muestra la app
        CredentialId    INT            NULL CONSTRAINT FK_Social_Connections_Credentials REFERENCES dbo.Platform_Credentials (Id),
        AvatarUrl       NVARCHAR(1000) NULL,
        AccountHint     NVARCHAR(200)  NULL,       -- @handle del canal o categoría de la Página
        Scopes          NVARCHAR(1000) NULL,
        TokenExpiresAt  DATETIME2(3)   NULL,       -- NULL = no caduca
        SecretCipher    NVARCHAR(MAX)  NULL,       -- token cifrado (AES-GCM). NULL al revocar o al pedir reconexión
        StatusCode      VARCHAR(20)    NOT NULL,
        StatusMessage   NVARCHAR(500)  NULL,
        IsDefault       BIT            NOT NULL,
        ConnectedBy     NVARCHAR(100)  NOT NULL,
        ConnectedAt     DATETIME2(3)   NOT NULL,
        LastUsedAt      DATETIME2(3)   NULL,
        LastTestAt      DATETIME2(3)   NULL,
        LastTestOk      BIT            NULL,
        LastTestMessage NVARCHAR(500)  NULL,
        RevokedAt       DATETIME2(3)   NULL,
        Signature       NVARCHAR(1000) NULL,       -- firma de la cuenta ({firma_cuenta})
        Extra           NVARCHAR(MAX)  NULL,       -- JSON propio de la plataforma (WhatsApp: wabaId)
        InboxDirect     BIT            NOT NULL CONSTRAINT DF_Social_Connections_InboxDirect DEFAULT (1),
        InboxComments   BIT            NOT NULL CONSTRAINT DF_Social_Connections_InboxComments DEFAULT (1),
        CONSTRAINT UQ_Social_Connections_ConnectionKey UNIQUE (ConnectionKey),
        CONSTRAINT CK_Social_Connections_Platform CHECK (Platform IN ('YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK', 'LINKEDIN', 'TEAMS', 'WHATSAPP')),
        CONSTRAINT CK_Social_Connections_Extra CHECK (Extra IS NULL OR ISJSON(Extra) = 1),
        CONSTRAINT CK_Social_Connections_StatusCode CHECK (StatusCode IN ('CONNECTED', 'NEEDS_RECONNECT', 'REVOKED')),
        CONSTRAINT CK_Social_Connections_Default CHECK (IsDefault = 0 OR StatusCode <> 'REVOKED')
    );
    PRINT N'1. dbo.Social_Connections creada.';
END
GO

IF OBJECT_ID(N'dbo.Publications', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Publications
    (
        Id                     BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Publications PRIMARY KEY,
        PostId                 INT               NOT NULL CONSTRAINT FK_Publications_Posts REFERENCES dbo.Posts (Id),
        VideoId                INT               NULL CONSTRAINT FK_Publications_Media_Assets REFERENCES dbo.Media_Assets (Id),  -- medio principal
        ConnectionId           INT               NOT NULL CONSTRAINT FK_Publications_Connections REFERENCES dbo.Social_Connections (Id),
        Target                 VARCHAR(20)       NOT NULL,
        Title                  NVARCHAR(255)     NOT NULL,
        Description            NVARCHAR(MAX)     NULL,  -- YouTube: <= 5000 bytes UTF-8 (lo valida la API)
        Tags                   NVARCHAR(600)     NULL,
        CategoryId             VARCHAR(10)       NULL,
        PrivacyStatus          VARCHAR(20)       NOT NULL,
        PublishAt              DATETIMEOFFSET(0) NULL,
        MadeForKids            BIT               NOT NULL,
        ContainsSyntheticMedia BIT               NOT NULL,
        NotifySubscribers      BIT               NOT NULL CONSTRAINT DF_Publications_Notify DEFAULT (1),
        Extra                  NVARCHAR(MAX)     NULL,      -- JSON con las opciones propias de cada plataforma
        ConsentAt              DATETIME2(3)      NOT NULL,  -- consentimiento expreso (política III.E.3.d de YouTube)
        StatusCode             VARCHAR(20)       NOT NULL,
        SessionData            NVARCHAR(MAX)     NULL,      -- URI de sesión de YouTube / sesión de Facebook (cifrada)
        CommitStartedAt        DATETIME2(3)      NULL,      -- inicio del paso irreversible (comprobar antes de resubir)
        BytesSent              BIGINT            NULL,
        TotalBytes             BIGINT            NULL,
        [Percent]              TINYINT           NULL,
        ExternalId             NVARCHAR(100)     NULL,      -- videoId de YouTube / video_id de Facebook
        ExternalUrl            NVARCHAR(500)     NULL,
        CommentExternalId      NVARCHAR(200)     NULL,      -- id del primer comentario, si se publicó
        Warning                NVARCHAR(500)     NULL,
        Attempts               INT               NOT NULL CONSTRAINT DF_Publications_Attempts DEFAULT (0),
        MaxAttempts            INT               NOT NULL CONSTRAINT DF_Publications_MaxAttempts DEFAULT (5),
        NextAttemptAt          DATETIME2(3)      NULL,
        PollCount              INT               NOT NULL CONSTRAINT DF_Publications_PollCount DEFAULT (0),
        UploadedAt             DATETIME2(3)      NULL,
        CompletedAt            DATETIME2(3)      NULL,
        LeaseOwner             VARCHAR(100)      NULL,
        LeaseUntil             DATETIME2(3)      NULL,
        LastProgressAt         DATETIME2(3)      NULL,
        ErrorCode              VARCHAR(100)      NULL,
        ErrorMessage           NVARCHAR(500)     NULL,
        RequestedBy            NVARCHAR(100)     NOT NULL,
        RequestedAt            DATETIME2(3)      NOT NULL,
        UpdatedBy              NVARCHAR(100)     NULL,
        UpdatedAt              DATETIME2(3)      NULL,
        [RowVersion]           ROWVERSION,
        CONSTRAINT CK_Publications_Target CHECK (Target IN ('YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK', 'LINKEDIN', 'TEAMS')),
        CONSTRAINT CK_Publications_Privacy CHECK (PrivacyStatus IN ('public', 'unlisted', 'private', 'followers', 'friends', 'connections')),
        CONSTRAINT CK_Publications_Status CHECK (StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'DONE', 'FAILED', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW', 'CANCELLED')),
        CONSTRAINT CK_Publications_Schedule CHECK (PublishAt IS NULL OR Target <> 'YOUTUBE' OR PrivacyStatus = 'private'),
        CONSTRAINT CK_Publications_Extra CHECK (Extra IS NULL OR ISJSON(Extra) = 1),
        CONSTRAINT CK_Publications_Percent CHECK ([Percent] IS NULL OR [Percent] <= 100)
    );
    PRINT N'1. dbo.Publications creada.';
END
GO

IF OBJECT_ID(N'dbo.Publication_Events', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Publication_Events
    (
        Id             BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Publication_Events PRIMARY KEY,
        PublicationId  BIGINT        NOT NULL CONSTRAINT FK_Publication_Events_Publications REFERENCES dbo.Publications (Id),
        VideoId        INT           NULL,
        Target         VARCHAR(20)   NOT NULL,
        StatusCode     VARCHAR(20)   NOT NULL,
        Message        NVARCHAR(500) NOT NULL,
        IsNotification BIT           NOT NULL CONSTRAINT DF_Publication_Events_IsNotification DEFAULT (0),
        IsRead         BIT           NOT NULL CONSTRAINT DF_Publication_Events_IsRead DEFAULT (1),
        CreatedAt      DATETIME2(3)  NOT NULL
    );
    PRINT N'1. dbo.Publication_Events creada.';
END
GO

IF OBJECT_ID(N'dbo.Youtube_Quota_Usage', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Youtube_Quota_Usage
    (
        DayPt        DATE        NOT NULL,
        Bucket       VARCHAR(20) NOT NULL,
        ConnectionId INT         NOT NULL CONSTRAINT DF_Youtube_Quota_Usage_Connection DEFAULT (0),  -- 0 = sin canal (al conectar)
        Units        INT         NOT NULL,
        CONSTRAINT PK_Youtube_Quota_Usage PRIMARY KEY (DayPt, Bucket, ConnectionId),
        CONSTRAINT CK_Youtube_Quota_Usage_Bucket CHECK (Bucket IN ('UPLOADS', 'GENERAL'))
    );
    PRINT N'1. dbo.Youtube_Quota_Usage creada.';
END
GO

IF OBJECT_ID(N'dbo.Media_Tags', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Media_Tags
    (
        VideoId INT          NOT NULL CONSTRAINT FK_Media_Tags_Media_Assets REFERENCES dbo.Media_Assets (Id),
        Tag     NVARCHAR(50) NOT NULL,
        CONSTRAINT PK_Media_Tags PRIMARY KEY (VideoId, Tag)
    );
    CREATE INDEX IX_Media_Tags_Tag ON dbo.Media_Tags (Tag) INCLUDE (VideoId);
    PRINT N'1. dbo.Media_Tags creada.';
END
GO

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
    PRINT N'1. dbo.Template_Media creada.';
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
    PRINT N'1. dbo.Hashtag_Blocks creada.';
END
GO

IF OBJECT_ID(N'dbo.Publication_Metrics', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Publication_Metrics
    (
        PublicationId BIGINT       NOT NULL CONSTRAINT PK_Publication_Metrics PRIMARY KEY
                                   CONSTRAINT FK_Publication_Metrics_Publications REFERENCES dbo.Publications (Id),
        Views         BIGINT       NULL,
        Likes         BIGINT       NULL,
        Comments      BIGINT       NULL,
        CollectedAt   DATETIME2(3) NOT NULL
    );
    PRINT N'1. dbo.Publication_Metrics creada.';
END
GO

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
        Phone       NVARCHAR(30)   NULL,       -- agenda: teléfono en formato +código país
        Email       NVARCHAR(200)  NULL,
        CreatedBy   NVARCHAR(100)  NULL,       -- agenda: quién lo dio de alta (NULL = llegó de una red)
        CreatedAt   DATETIME2(3)   NOT NULL,
        UpdatedAt   DATETIME2(3)   NULL,
        CONSTRAINT UQ_Inbox_Contacts_External UNIQUE (Platform, ExternalId)
    );
    PRINT N'1. dbo.Inbox_Contacts creada.';
END
GO

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
    PRINT N'1. dbo.Inbox_Invites creada.';
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
    PRINT N'1. dbo.Inbox_Conversations creada.';
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
    PRINT N'1. dbo.Inbox_Conversation_Tags creada.';
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
    PRINT N'1. dbo.Inbox_Messages creada.';
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
    PRINT N'1. dbo.Inbox_Events creada.';
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
    PRINT N'1. dbo.Inbox_Sync_State creada.';
END
GO

/* ---------------------------------------------------------------------------------------------------------------------
   2. ÍNDICES
   --------------------------------------------------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Media_Assets_Status_Created' AND object_id = OBJECT_ID(N'dbo.Media_Assets'))
    CREATE INDEX IX_Media_Assets_Status_Created ON dbo.Media_Assets (StatusCode, CreatedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Media_Assets_StoragePath' AND object_id = OBJECT_ID(N'dbo.Media_Assets'))
    CREATE UNIQUE INDEX UX_Media_Assets_StoragePath ON dbo.Media_Assets (StoragePath);
GO

-- Una sola cuenta predeterminada por plataforma.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Social_Connections_Default' AND object_id = OBJECT_ID(N'dbo.Social_Connections'))
    CREATE UNIQUE INDEX UX_Social_Connections_Default ON dbo.Social_Connections (Platform) WHERE IsDefault = 1;
GO

-- La misma cuenta no se conecta dos veces: volver a conectarla actualiza su fila.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Social_Connections_Account' AND object_id = OBJECT_ID(N'dbo.Social_Connections'))
    CREATE UNIQUE INDEX UX_Social_Connections_Account ON dbo.Social_Connections (Platform, ExternalId)
        WHERE StatusCode IN ('CONNECTED', 'NEEDS_RECONNECT');
GO

-- Un mismo bot no se guarda dos veces.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Platform_Credentials_Public' AND object_id = OBJECT_ID(N'dbo.Platform_Credentials'))
    CREATE UNIQUE INDEX UX_Platform_Credentials_Public ON dbo.Platform_Credentials (Platform, PublicId)
        WHERE StatusCode = 'ACTIVE' AND PublicId IS NOT NULL;
GO

-- Una sola publicación viva por (post, cuenta).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Publications_Live' AND object_id = OBJECT_ID(N'dbo.Publications'))
    CREATE UNIQUE INDEX UX_Publications_Live ON dbo.Publications (PostId, ConnectionId)
        WHERE StatusCode IN ('PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publications_Due' AND object_id = OBJECT_ID(N'dbo.Publications'))
    CREATE INDEX IX_Publications_Due ON dbo.Publications (Target, StatusCode, NextAttemptAt) INCLUDE (LeaseUntil);
GO

-- Consulta de estado de lo ya subido (USP_BG_PUBLICATION_POLL_DUE_LIST).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publications_Poll' AND object_id = OBJECT_ID(N'dbo.Publications'))
    CREATE INDEX IX_Publications_Poll ON dbo.Publications (NextAttemptAt) INCLUDE (LeaseUntil) WHERE StatusCode = 'PROCESSING';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publications_Video' AND object_id = OBJECT_ID(N'dbo.Publications'))
    CREATE INDEX IX_Publications_Video ON dbo.Publications (VideoId, ConnectionId, Id DESC) INCLUDE (Target, StatusCode, [Percent], ExternalUrl);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publications_Post' AND object_id = OBJECT_ID(N'dbo.Publications'))
    CREATE INDEX IX_Publications_Post ON dbo.Publications (PostId, ConnectionId, Id DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Post_Media_Media' AND object_id = OBJECT_ID(N'dbo.Post_Media'))
    CREATE INDEX IX_Post_Media_Media ON dbo.Post_Media (MediaId) INCLUDE (PostId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publications_Schedule' AND object_id = OBJECT_ID(N'dbo.Publications'))
    CREATE INDEX IX_Publications_Schedule ON dbo.Publications (PublishAt) INCLUDE (VideoId, ConnectionId, Target, StatusCode)
        WHERE PublishAt IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publications_Completed' AND object_id = OBJECT_ID(N'dbo.Publications'))
    CREATE INDEX IX_Publications_Completed ON dbo.Publications (CompletedAt) INCLUDE (ConnectionId, Target, StatusCode, RequestedAt)
        WHERE CompletedAt IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publication_Events_Video' AND object_id = OBJECT_ID(N'dbo.Publication_Events'))
    CREATE INDEX IX_Publication_Events_Video ON dbo.Publication_Events (VideoId, Id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publication_Events_Publication' AND object_id = OBJECT_ID(N'dbo.Publication_Events'))
    CREATE INDEX IX_Publication_Events_Publication ON dbo.Publication_Events (PublicationId, Id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Publication_Events_Notification' AND object_id = OBJECT_ID(N'dbo.Publication_Events'))
    CREATE INDEX IX_Publication_Events_Notification ON dbo.Publication_Events (Id DESC) INCLUDE (IsRead) WHERE IsNotification = 1;
GO

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

-- Un teléfono no se repite en la agenda.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Inbox_Contacts_AgendaPhone' AND object_id = OBJECT_ID(N'dbo.Inbox_Contacts'))
    CREATE UNIQUE INDEX UX_Inbox_Contacts_AgendaPhone ON dbo.Inbox_Contacts (Phone) WHERE Platform = 'AGENDA' AND Phone IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Inbox_Invites_Contact' AND object_id = OBJECT_ID(N'dbo.Inbox_Invites'))
    CREATE INDEX IX_Inbox_Invites_Contact ON dbo.Inbox_Invites (ContactId, CreatedAt DESC);
GO

IF OBJECT_ID(N'dbo.Schema_Versions', N'U') IS NULL
    CREATE TABLE dbo.Schema_Versions
    (
        Version     VARCHAR(20)   NOT NULL CONSTRAINT PK_Schema_Versions PRIMARY KEY,
        Description NVARCHAR(200) NOT NULL,
        AppliedAt   DATETIME2(3)  NOT NULL CONSTRAINT DF_Schema_Versions_AppliedAt DEFAULT (SYSUTCDATETIME())
    );
GO

INSERT INTO dbo.Schema_Versions (Version, Description)
SELECT V.Version, V.Description
FROM (VALUES ('001', N'Esquema inicial'), ('003', N'Varias cuentas y plataformas'), ('004', N'Fiabilidad de la cola, NEEDS_REVIEW e índices'),
             ('005', N'Etiquetas, plantillas, firmas y métricas'), ('006', N'Publicaciones con varios medios y LinkedIn'), ('007', N'Microsoft Teams'),
             ('008', N'Bandeja unificada, WhatsApp y panel de inicio'), ('009', N'Agenda de contactos e invitaciones'),
             ('010', N'Plantillas propias con etiquetas y adjuntos'))
     AS V (Version, Description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Schema_Versions AS S WHERE S.Version = V.Version);
GO

PRINT N'2. Índices OK. Esquema listo: ejecuta 002-procedimientos.sql.';
GO
SET NOEXEC OFF;
GO
