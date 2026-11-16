export interface ICustomGenericResponse<T> {
  isSuccess: boolean;
  message: string;
  data?: T;
}

/** Plataformas de la app. WHATSAPP solo existe en la bandeja (no publica). */
export type Platform = 'YOUTUBE' | 'FACEBOOK' | 'INSTAGRAM' | 'TELEGRAM' | 'TIKTOK' | 'LINKEDIN' | 'TEAMS' | 'WHATSAPP';

export type MediaKind = 'VIDEO' | 'IMAGE' | 'DOCUMENT';

/**
 * Tipo de publicación, deducido de los medios: TEXT (sin medios ni enlace), LINK (sin medios y con
 * enlace), IMAGE (1 imagen), CAROUSEL (2+ imágenes), VIDEO (1 video) y DOCUMENT (1 PDF).
 */
export type PostKind = 'TEXT' | 'LINK' | 'IMAGE' | 'CAROUSEL' | 'VIDEO' | 'DOCUMENT';

export type PublicationStatus =
  | 'PENDING'
  | 'UPLOADING'
  | 'PROCESSING'
  | 'DONE'
  | 'FAILED'
  | 'WAITING_QUOTA'
  | 'NEEDS_RECONNECT'
  | 'NEEDS_REVIEW'
  | 'CANCELLED';

/** YouTube usa public/unlisted/private; TikTok además followers y friends; LinkedIn public o connections (solo perfiles). */
export type PrivacyStatus = 'public' | 'unlisted' | 'private' | 'followers' | 'friends' | 'connections';

export interface ILoginResponse {
  token: string;
  userName: string;
  displayName: string;
  expiresAt: string;
}

export interface IVideo {
  id: number;
  title: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  hasPoster: boolean;
  /** Video, imagen o PDF. Si falta (respuestas antiguas) se trata como VIDEO. */
  mediaKind?: MediaKind;
  createdBy: string;
  createdAt: string;
  /** Etiquetas normalizadas (minúsculas, sin #, espacios → -). */
  tags?: string[];
  /** Última publicación de cada cuenta (sin las canceladas). */
  publications: IVideoPublication[];
}

export type LibraryStatus = 'UNPUBLISHED' | 'PUBLISHED' | 'ERROR' | 'SCHEDULED' | 'ACTIVE';
export type LibrarySort = 'NEWEST' | 'OLDEST' | 'TITLE' | 'SIZE' | 'DURATION';

export interface IVideoQuery {
  searchTerm?: string;
  status?: LibraryStatus | '';
  platform?: Platform | '';
  tag?: string;
  kind?: MediaKind | '';
  sort?: LibrarySort;
  offset?: number;
  take?: number;
}

export interface IPage<T> {
  items: T[];
  total: number;
}

export interface ITagCount {
  tag: string;
  videoCount: number;
}

export interface IBulkResult {
  done: number;
  errors: string[];
}

export interface IVideoPublication {
  publicationId: number;
  connectionId: number;
  target: Platform;
  connectionName: string;
  avatarUrl: string | null;
  statusCode: PublicationStatus;
  percent: number | null;
  externalUrl: string | null;
  publishAt?: string | null;
}

export interface IPublication {
  id: number;
  /** null en publicaciones sin medios (texto o enlace). */
  videoId: number | null;
  /** Título del primer medio; sin medios, el título de la publicación. */
  videoTitle: string;
  postId: number;
  postKind: PostKind;
  mediaCount: number;
  /** Publicado, pero el primer comentario no se pudo poner: se ofrece «Reintentar comentario». */
  commentPending: boolean;
  target: Platform;
  connectionId: number;
  connectionName: string;
  connectionAvatarUrl: string | null;
  title: string;
  privacyStatus: PrivacyStatus;
  publishAt: string | null;
  statusCode: PublicationStatus;
  percent: number | null;
  bytesSent: number | null;
  totalBytes: number | null;
  externalUrl: string | null;
  warning: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  isSending: boolean;
  requestedBy: string;
  requestedAt: string;
  updatedAt: string | null;
  completedAt?: string | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
}

export interface IPublicationQuery {
  videoId?: number;
  group?: string;
  platform?: Platform | '';
  connectionId?: number | null;
  searchTerm?: string;
  /** Fechas UTC ISO. */
  from?: string | null;
  to?: string | null;
}

export type ResolveAction = 'MARK_DONE' | 'REUPLOAD';

export interface ICalendarItem {
  id: number;
  videoId: number | null;
  postId: number;
  postKind: PostKind;
  videoTitle: string;
  hasPoster: boolean;
  target: Platform;
  connectionId: number;
  connectionName: string;
  connectionAvatarUrl: string | null;
  title: string;
  statusCode: PublicationStatus;
  publishAt: string | null;
  /** Momento que se pinta en el calendario (programado o real). */
  when: string;
  externalUrl: string | null;
  canReschedule: boolean;
}

export interface IPublicationRules {
  titleMax: number;
  youtubeTitleMax: number;
  youtubeDescriptionMaxBytes: number;
  youtubeTagsMax: number;
  facebookTitleMax: number;
  facebookDescriptionMax: number;
  facebookScheduleMinMinutes: number;
  instagramCaptionMax: number;
  instagramHashtagsMax: number;
  instagramMentionsMax: number;
  instagramMaxBytes: number;
  instagramMinSeconds: number;
  instagramMaxSeconds: number;
  telegramCaptionMax: number;
  tiktokTitleMax: number;
  tiktokMaxBytes: number;
  scheduleMaxMonths: number;
  linkedinTitleMax: number;
  linkedinTextMax: number;
  linkedinVideoMaxBytes: number;
  telegramTextMax: number;
  firstCommentMax: number;
  maxMedia: number;
  /** La API se sirve desde un dominio público (App:PublicBaseUrl): Instagram y TikTok pueden descargar imágenes. */
  publicMediaAvailable: boolean;
  platforms: Record<Platform, IPlatformCapability>;
  /** Canales de Teams conectados por webhook (Workflows): admiten menos que los conectados con Graph. */
  teamsWebhook: IPlatformCapability;
  /** Plataformas activas en esta instalación (Platforms:Disabled en el servidor). Las demás no se muestran. */
  enabledPlatforms: Platform[];
}

/** Lo que admite cada plataforma (PlatformCapabilities del servidor). */
export interface IPlatformCapability {
  platform: Platform;
  kinds: PostKind[];
  maxImages: number;
  imageMaxBytes: number;
  /** Tipos MIME, p. ej. image/jpeg. */
  imageTypes: string[];
  /** La plataforma descarga las imágenes desde una URL pública (no admite el archivo). */
  imagesNeedPublicUrl: boolean;
  firstComment: boolean;
  /** Límite del texto en publicaciones sin medios (null = el de siempre). */
  textMax: number | null;
  documentMaxBytes: number | null;
}

/** Para qué es una plantilla propia: publicar o responder en la bandeja (/atajo). */
export type TemplateUsage = 'PUBLISH' | 'REPLY';

/** Adjunto de una plantilla: un medio de la biblioteca (missing = se borró de ella; al usarla se omite). */
export interface ITemplateMedia {
  position: number;
  mediaId: number;
  altText: string | null;
  title: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  mediaKind: MediaKind;
  hasPoster: boolean;
  missing: boolean;
  createdBy: string;
  createdAt: string;
}

export interface ITemplate {
  id: number;
  usage: TemplateUsage;
  name: string;
  /** Solo respuestas: se elige escribiendo /atajo. */
  shortcut: string | null;
  /** Solo publicaciones. */
  title: string | null;
  /** Texto con etiquetas ({titulo}, {nombre}, {?campo}, #bloque:x). */
  body: string | null;
  /** Etiquetas de YouTube (solo publicaciones). */
  tags: string | null;
  /** Redes donde se ofrece; vacía = en todas. */
  platforms: Platform[];
  isDefault: boolean;
  useCount: number;
  lastUsedAt: string | null;
  updatedAt: string | null;
  media: ITemplateMedia[];
}

export interface ITemplateSave {
  usage: TemplateUsage;
  name: string;
  shortcut?: string | null;
  title?: string | null;
  body?: string | null;
  tags?: string | null;
  platforms: Platform[];
  isDefault: boolean;
  media: { mediaId: number; alt?: string | null }[];
}

export interface ITextBlock {
  id: number;
  name: string;
  content: string;
  updatedAt?: string | null;
}

export interface IPlaylist {
  id: string;
  title: string;
  itemCount: number;
}

export interface IInsights {
  days: number;
  published: number;
  failed: number;
  successRate: number;
  views: number;
  likes: number;
  comments: number;
  avgMinutes: number | null;
  daily: { day: string; done: number; failed: number }[];
  accounts: IAccountInsight[];
  /** Mensajes de la bandeja en el mismo periodo. */
  inbox: IInboxStats;
}

export interface IAccountInsight {
  connectionId: number;
  platform: Platform;
  connectionName: string;
  avatarUrl: string | null;
  published: number;
  failed: number;
  views: number;
  likes: number;
  comments: number;
  avgMinutes: number | null;
}

export type HealthStatus = 'ok' | 'warn' | 'error';

export interface IHealth {
  status: HealthStatus;
  queue: {
    queueDue: number;
    processing: number;
    scheduled: number;
    oldestDueMinutes: number | null;
    stuckUploads: number;
    needsReview: number;
    failedLast7Days: number;
    connectionsNeedingReconnect: number;
    tokensExpiringSoon: number;
    connectionsFailingTest: number;
    inboxEventsFailed: number;
    inboxSendProblems: number;
    inboxSyncErrors: number;
  };
  youtubeUploadsUsed: number;
  youtubeUploadsLimit: number;
  youtubeUnitsUsed: number;
  youtubeUnitsLimit: number;
  storageUsedBytes: number;
  storageFreeBytes: number;
  jobLanes: Record<string, string | null>;
  alerts: string[];
}

export interface IPublicationEvent {
  id: number;
  publicationId: number;
  target: Platform;
  statusCode: PublicationStatus;
  message: string;
  createdAt: string;
}

/** Un medio de la publicación, en orden; `alt` = texto alternativo (accesibilidad). */
export interface IPostMedia {
  id: number;
  alt?: string;
}

/** Un clic en Publicar: la misma publicación (texto + 0..N medios) a una o varias cuentas. */
export interface IPublicationCreate {
  media: IPostMedia[];
  /** Solo en publicaciones sin medios. */
  linkUrl?: string;
  title?: string;
  consent: boolean;
  destinations: IPublicationDestination[];
}

export interface IPublicationDestination {
  connectionId: number;
  title: string;
  description: string | null;
  tags: string | null;
  categoryId: string | null;
  privacyStatus: PrivacyStatus | null;
  publishAt: string | null;
  madeForKids: boolean | null;
  containsSyntheticMedia: boolean | null;
  notifySubscribers: boolean;
  options: IPublicationOptions | null;
}

/** Opciones propias de cada plataforma (se guardan como JSON). */
export interface IPublicationOptions {
  shareToFeed?: boolean;
  disableNotification?: boolean;
  protectContent?: boolean;
  tiktokMode?: TiktokMode;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  brandContent?: boolean;
  brandOrganic?: boolean;
  isAigc?: boolean;
  playlistId?: string;
  /** Comentario que la cuenta pone justo después de publicar (si la plataforma lo admite). */
  firstComment?: string;
  /** Teams (Graph): mencionar al canal (@canal) para avisar a todos. */
  teamsMentionChannel?: boolean;
}

export type TiktokMode = 'DIRECT' | 'INBOX';

export interface IPublicationCreateResult {
  connectionId: number;
  accountName: string;
  publicationId: number | null;
  error: string | null;
}

export type ConnectionStatus = 'CONNECTED' | 'NEEDS_RECONNECT' | 'REVOKED';

export interface IConnection {
  id: number;
  platform: Platform;
  externalId: string;
  displayName: string;
  alias: string | null;
  avatarUrl: string | null;
  accountHint: string | null;
  scopes: string | null;
  tokenExpiresAt: string | null;
  statusCode: ConnectionStatus;
  statusMessage: string | null;
  isDefault: boolean;
  credentialId: number | null;
  credentialName: string | null;
  /** Firma de la cuenta: {firma_cuenta} en las plantillas. */
  signature?: string | null;
  /** Telegram: tamaño máximo del servidor Bot API del bot. */
  uploadLimitMb: number | null;
  connectedBy: string;
  connectedAt: string;
  lastUsedAt: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  revokedAt: string | null;
}

export interface IConnectionsStatus {
  googleConfigured: boolean;
  googleRedirectUri: string | null;
  tiktokConfigured: boolean;
  tiktokRedirectUri: string | null;
  linkedinConfigured: boolean;
  linkedinRedirectUri: string | null;
  linkedinOrgConfigured: boolean;
  linkedinOrgRedirectUri: string | null;
  teamsConfigured: boolean;
  teamsRedirectUri: string | null;
  telegramBots: number;
  graphVersion: string;
  /** Cuentas conectadas o pendientes de reconexión, de todas las plataformas. */
  accounts: IConnection[];
  history: IConnection[];
}

/** Página de Facebook o cuenta de Instagram a la que da acceso el token del usuario del sistema. */
export interface IMetaAccountOption {
  id: string;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  detail: string | null;
  canPublish: boolean;
  problem: string | null;
  alreadyConnected: boolean;
}

export interface IAccountSaveResult {
  name: string;
  connectionId: number | null;
  isNew: boolean;
  error: string | null;
}

export interface ITelegramChat {
  id: string;
  title: string;
  username: string | null;
  type: string;
  canPost: boolean;
  problem: string | null;
  alreadyConnected: boolean;
}

/** creator_info de TikTok: lo que el formulario debe ofrecer antes de publicar. */
export interface ITiktokCreatorInfo {
  nickname: string;
  username: string | null;
  avatarUrl: string | null;
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSec: number;
}

export interface IConnectionTest {
  isOk: boolean;
  message: string;
}

export interface ICategory {
  id: string;
  title: string;
}

export interface IUsage {
  dayPt: string;
  uploads: number;
  uploadsLimit: number;
  units: number;
  unitsLimit: number;
  resetsAtUtc: string;
  /** Quién gastó la cuota de YouTube hoy. El límite es la suma de todos los canales. */
  channels: IQuotaChannel[];
  storageRoot: string;
  storageUsedBytes: number;
  storageFreeBytes: number;
}

export interface IQuotaChannel {
  connectionId: number;
  displayName: string;
  uploads: number;
  units: number;
}

export interface INotification {
  id: number;
  publicationId: number;
  videoId: number | null;
  videoTitle: string;
  target: Platform;
  connectionName: string;
  statusCode: PublicationStatus;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface ITusConfig {
  ttlMinutes: number;
  maxUploadBytes: number;
  allowedExtensions: string[];
}

/** Payload de ReceiveEntityUpdate para la entidad «VideoPublish». */
export interface IPublishUpdate {
  publicationId: number;
  videoId: number | null;
  connectionId: number | null;
  target: Platform;
  status: PublicationStatus;
  percent: number | null;
  isFinal: boolean;
}

/** Ajustes › Plataformas. */
export interface IPlatformSettings {
  google: ICredentialSource;
  tiktok: ICredentialSource;
  /** App de LinkedIn para perfiles personales. */
  linkedin: ICredentialSource;
  /** App de LinkedIn para páginas de empresa (Community Management API). */
  linkedinOrg: ICredentialSource;
  /** App de Microsoft Entra para Teams (Graph). */
  teams: ITeamsCredentialSource;
  /** App de Meta para los avisos (webhooks) de la bandeja: Facebook, Instagram y WhatsApp. */
  metaApp: IMetaAppCredentialSource;
  telegramBots: ICredential[];
}

/** Como ICredentialSource, más lo que se pega en la app de Meta para los webhooks. */
export interface IMetaAppCredentialSource extends ICredentialSource {
  webhookUrl?: string | null;
  verifyToken?: string | null;
}

/** Cualquier clave de Ajustes con sus datos opcionales (Teams o la app de Meta). */
export type IClientCredentialSource = ITeamsCredentialSource & IMetaAppCredentialSource;

/** Como ICredentialSource, más el inquilino y la caducidad del secreto (Entra los da aparte). */
export interface ITeamsCredentialSource extends ICredentialSource {
  tenantId?: string | null;
  /** yyyy-MM-dd */
  secretExpiresAt?: string | null;
}

/** Equipos y canales a los que da acceso la cuenta de trabajo (GET /api/Connection/Teams/Channels). */
export interface ITeamsChannelTree {
  account: { name: string; email: string };
  teams: ITeamsTeam[];
}

export interface ITeamsTeam {
  id: string;
  name: string;
  channels: ITeamsChannel[];
}

export type TeamsMembership = 'standard' | 'private' | 'shared';

export interface ITeamsChannel {
  id: string;
  name: string;
  membershipType: TeamsMembership;
  connected: boolean;
}

export type CredentialSource = 'DATABASE' | 'CONFIG' | 'NONE';

export interface ICredentialSource {
  source: CredentialSource;
  credentialId: number | null;
  publicId: string | null;
  redirectUri: string | null;
  updatedAt: string | null;
}

export interface ICredential {
  id: number;
  platform: Platform;
  name: string;
  publicId: string | null;
  options: { apiBaseUrl: string | null; maxUploadMb: number | null };
  inUse: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string | null;
}

/** Credenciales que se guardan en Ajustes: las de cada plataforma, la app de empresa de LinkedIn y la app de Meta. */
export type CredentialPlatform = Platform | 'LINKEDIN_ORG' | 'META';

export interface ICredentialSave {
  id?: number | null;
  platform: CredentialPlatform;
  publicId?: string | null;
  secret?: string | null;
  apiBaseUrl?: string | null;
  maxUploadMb?: number | null;
  /** Teams: Id. de directorio (inquilino). */
  tenantId?: string | null;
  /** Teams: fecha de caducidad del secreto (yyyy-MM-dd). */
  secretExpiresAt?: string | null;
}

// ------------------------------------------------------------------------------------------------------------------
// BANDEJA
// ------------------------------------------------------------------------------------------------------------------

/** DIRECT = privado; COMMENTS = comentarios de una publicación; GROUP = grupo (Telegram). */
export type InboxKind = 'DIRECT' | 'COMMENTS' | 'GROUP';
export type InboxStatus = 'OPEN' | 'PENDING' | 'CLOSED';
export type InboxDirection = 'IN' | 'OUT' | 'NOTE';
export type InboxMessageStatus = 'RECEIVED' | 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'NEEDS_REVIEW' | 'CANCELLED';
export type InboxResolveAction = 'RETRY' | 'MARK_SENT' | 'CANCEL';
export type InboxMode = 'WEBHOOK' | 'POLL' | 'NONE';
export type InboxFix = 'RECONNECT' | 'SETTINGS' | 'GUIDE';

export interface IInboxConversation {
  id: number;
  connectionId: number;
  platform: Platform;
  accountName: string;
  accountAvatarUrl: string | null;
  kind: InboxKind;
  externalId: string;
  title: string;
  link: string | null;
  statusCode: InboxStatus;
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastInboundAt: string | null;
  /** Primer mensaje sin responder (null = respondida). */
  awaitingSince: string | null;
  assignedTo: string | null;
  publicationId: number | null;
  videoId: number | null;
  contactId: number | null;
  contactName: string | null;
  contactHandle: string | null;
  contactAvatarUrl: string | null;
  /** Messenger, Instagram y WhatsApp: hasta cuándo se puede responder con texto libre. */
  windowExpiresAt: string | null;
  /** La empezamos nosotros y la persona aún no escribió: solo plantilla (WhatsApp). */
  windowNeverOpened?: boolean;
  tags: string[];
}

export interface IInboxConversationQuery {
  status?: InboxStatus | '';
  platform?: Platform | '';
  kind?: InboxKind | '';
  unread?: boolean;
  awaiting?: boolean;
  tag?: string;
  searchTerm?: string;
  beforeAt?: string;
  beforeId?: number;
  take?: number;
}

export interface IInboxAttachment {
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'other';
  name: string | null;
  url: string | null;
  mediaId: string | null;
  /** Archivo de la biblioteca que enviamos nosotros. */
  libraryId?: number | null;
  /** Copia local de un archivo recibido: se abre aunque la red ya lo haya caducado. */
  storedPath?: string | null;
  contentType: string | null;
}

export interface IInboxMessage {
  id: number;
  conversationId: number;
  externalId: string | null;
  parentExternalId: string | null;
  direction: InboxDirection;
  authorName: string | null;
  authorExternalId: string | null;
  body: string | null;
  sentAt: string;
  statusCode: InboxMessageStatus;
  errorMessage: string | null;
  attempts: number;
  createdBy: string | null;
  attachments: IInboxAttachment[];
  template: string | null;
  privateReply: boolean;
}

export interface IInboxReply {
  body?: string | null;
  note?: boolean;
  parentExternalId?: string | null;
  privateReply?: boolean;
  mediaIds?: number[];
  templateName?: string | null;
  templateLanguage?: string | null;
  templateParams?: string[];
}

export interface IInboxCounts {
  open: number;
  pending: number;
  closed: number;
  unread: number;
  awaiting: number;
}

/** Dónde está el contacto: una red o la agenda (alta a mano, sin cuenta en una red todavía). */
export type ContactSource = Platform | 'AGENDA';

export interface IInboxContact {
  id: number;
  platform: ContactSource;
  externalId: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  personId: number | null;
  /** Agenda: teléfono (+código país) y correo. */
  phone?: string | null;
  email?: string | null;
  createdAt: string;
  conversations: number;
  lastConversationId: number | null;
}

/** Enlace para que la persona abra el chat (Telegram, Messenger, Instagram). */
export interface IInboxInvite {
  id: number;
  code: string;
  contactId: number;
  connectionId: number;
  platform: Platform;
  accountName: string;
  link: string;
  expiresAt: string;
  /** Cuándo abrió el chat con el enlace (null = pendiente). */
  usedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface IInboxContactDetail {
  contact: IInboxContact;
  /** La misma persona en otras redes y en la agenda. */
  linked: IInboxContact[];
  invites?: IInboxInvite[];
}

export interface IContactCreate {
  displayName: string;
  phone?: string | null;
  email?: string | null;
}

/** Escribir primero por WhatsApp: a un número y con plantilla aprobada. */
export interface IConversationStart {
  connectionId: number;
  contactId?: number | null;
  phone: string;
  displayName?: string | null;
  templateName: string;
  templateLanguage: string | null;
  templateParams: string[];
  consent: boolean;
}

export interface IInboxCapability {
  textMax: number;
  windowHours: number | null;
  attachments: boolean;
  attachmentsNeedPublicUrl: boolean;
  privateReply: boolean;
  templates: boolean;
  quotaUnits: number;
}

/** GET /api/Inbox/Rules. Clave de capabilities: «PLATAFORMA:TIPO». */
export interface IInboxRules {
  capabilities: Record<string, IInboxCapability>;
  windowHours: number;
  humanAgentDays: number | null;
  publicMediaAvailable: boolean;
  youtubeReplyUnits: number;
  noteMax: number;
}

export interface IInboxAccount {
  id: number;
  platform: Platform;
  name: string;
  avatarUrl: string | null;
  accountHint: string | null;
  statusCode: ConnectionStatus;
  credentialName: string | null;
  inboxDirect: boolean;
  inboxComments: boolean;
  supportsDirect: boolean;
  supportsComments: boolean;
  mode: InboxMode;
  problem: string | null;
  fix: InboxFix | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastInboundAt: string | null;
  openConversations: number;
}

export interface IInboxSettings {
  accounts: IInboxAccount[];
  publicUrlConfigured: boolean;
  metaWebhookUrl: string | null;
  metaVerifyToken: string | null;
  metaAppConfigured: boolean;
  humanAgentEnabled: boolean;
  retentionMonths: number;
  /** Se guarda una copia de los archivos recibidos, hasta este tamaño. */
  keepReceivedFiles?: boolean;
  keepFileMaxMb?: number;
  /** Días que vale un enlace de invitación. */
  inviteDays?: number;
}

export interface IWhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  paramCount: number;
}

export interface IInboxStats {
  received: number;
  sent: number;
  avgResponseMinutes: number | null;
  daily: { day: string; received: number; sent: number }[];
  platforms: { platform: Platform; received: number; sent: number; conversations: number; avgResponseMinutes: number | null }[];
}

/** Evento Inbox del hub: llegó o cambió algo en una conversación. */
export interface IInboxUpdate {
  conversationId: number;
  isNew: boolean;
}

// ------------------------------------------------------------------------------------------------------------------
// INICIO
// ------------------------------------------------------------------------------------------------------------------

export interface IHomeSummary {
  kpis: {
    awaiting: number;
    windowsClosing: number;
    avgResponseMinutes: number | null;
    avgResponseMinutesPrevious: number | null;
    publishedToday: number;
    scheduledToday: number;
    failedRecent: number;
    connections: number;
    connectionsAttention: number;
  };
  urgent: IInboxConversation[];
  agenda: IHomeAgendaItem[];
  activity: { day: string; received: number; published: number }[];
}

export interface IHomeAgendaItem {
  id: number;
  videoId: number | null;
  title: string;
  target: Platform;
  connectionName: string;
  statusCode: PublicationStatus;
  at: string;
  isProblem: boolean;
}
