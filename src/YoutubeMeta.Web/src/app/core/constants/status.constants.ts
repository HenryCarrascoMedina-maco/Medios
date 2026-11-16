import type { ChipTone } from '@shared/ui/chip.component';
import type { IconName } from '@shared/ui/icons';
import { GuidePlatform } from '../guides/guide.models';
import {
  ConnectionStatus, CredentialSource, HealthStatus, InboxKind, InboxMessageStatus, InboxMode, InboxStatus, MediaKind, Platform, PostKind, PrivacyStatus,
  PublicationStatus
} from '../models/api.models';

/** Estados con algo pendiente: no se ofrece «Publicar aquí» otra vez. */
export const LIVE_STATUSES: readonly PublicationStatus[] = ['PENDING', 'UPLOADING', 'PROCESSING', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW'];

/** NONE = la cuenta aún no tiene publicación. `icon` distingue los estados que piden atención aunque el color se parezca. */
export const STATUS_META: Record<PublicationStatus | 'NONE', { label: string; tone: ChipTone; icon?: IconName }> = {
  NONE: { label: 'Sin publicar', tone: 'outline' },
  PENDING: { label: 'En cola', tone: 'neutral' },
  UPLOADING: { label: 'Subiendo', tone: 'brand' },
  PROCESSING: { label: 'Procesando', tone: 'violet' },
  DONE: { label: 'Publicado', tone: 'success' },
  FAILED: { label: 'Falló', tone: 'danger' },
  WAITING_QUOTA: { label: 'Esperando cuota', tone: 'warning' },
  NEEDS_RECONNECT: { label: 'Reconectar', tone: 'danger' },
  NEEDS_REVIEW: { label: 'Revisar', tone: 'warning', icon: 'eye' },
  CANCELLED: { label: 'Cancelado', tone: 'outline' }
};

export const CONNECTION_STATUS_META: Record<ConnectionStatus, { label: string; tone: ChipTone }> = {
  CONNECTED: { label: 'Conectada', tone: 'success' },
  NEEDS_RECONNECT: { label: 'Reconectar', tone: 'danger' },
  REVOKED: { label: 'Quitada', tone: 'outline' }
};

export const CREDENTIAL_SOURCE_META: Record<CredentialSource, { label: string; tone: ChipTone }> = {
  DATABASE: { label: 'Guardada aquí', tone: 'success' },
  CONFIG: { label: 'Desde user-secrets / IIS', tone: 'success' },
  NONE: { label: 'Sin configurar', tone: 'warning' }
};

export const HEALTH_META: Record<HealthStatus, { label: string; tone: ChipTone; dot: string }> = {
  ok: { label: 'Todo en orden', tone: 'success', dot: 'text-green-500' },
  warn: { label: 'Requiere atención', tone: 'warning', dot: 'text-amber-500' },
  error: { label: 'Hay problemas', tone: 'danger', dot: 'text-red-500' }
};

/**
 * Carriles del job tal como los nombra la API («Job/carril») y cuántos minutos pueden pasar sin vuelta antes de
 * marcarse como atrasados. Los de publicación dan una vuelta cada 30 s, pero una subida larga la alarga.
 */
export const JOB_LANES: Record<string, { label: string; staleMinutes: number }> = {
  'VideoPublishJob/poll': { label: 'Consulta de estado', staleMinutes: 10 },
  'VideoPublishJob/youtube': { label: 'Subidas a YouTube', staleMinutes: 120 },
  'VideoPublishJob/facebook': { label: 'Subidas a Facebook', staleMinutes: 60 },
  'VideoPublishJob/instagram': { label: 'Subidas a Instagram', staleMinutes: 60 },
  'VideoPublishJob/telegram': { label: 'Envíos a Telegram', staleMinutes: 60 },
  'VideoPublishJob/tiktok': { label: 'Subidas a TikTok', staleMinutes: 60 },
  'VideoPublishJob/linkedin': { label: 'Publicaciones en LinkedIn', staleMinutes: 60 },
  'VideoPublishJob/teams': { label: 'Publicaciones en Teams', staleMinutes: 60 },
  'MetricsJob/metrics': { label: 'Métricas', staleMinutes: 150 },
  'StorageCleanupJob/cleanup': { label: 'Limpieza', staleMinutes: 150 },
  'TokenKeepAliveJob/keepalive': { label: 'Prueba de cuentas', staleMinutes: 150 },
  'InboxJob/ingest': { label: 'Bandeja: entrada', staleMinutes: 10 },
  'InboxJob/send': { label: 'Bandeja: envío de respuestas', staleMinutes: 10 },
  'InboxJob/poll': { label: 'Bandeja: consultas (YouTube, Teams…)', staleMinutes: 30 }
};

/** Para un carril desconocido. */
export const DEFAULT_LANE_STALE_MINUTES = 15;

/** Todo lo visual de cada plataforma en un sitio: las plantillas no repiten «if youtube / facebook». */
export interface IPlatformMeta {
  label: string;
  icon: IconName;
  /** Clases de color: texto, fondo, botón y barra de progreso. */
  text: string;
  bg: string;
  btn: string;
  bar: string;
  /** Cómo se llama una cuenta en esa plataforma. */
  noun: string;
  nounPlural: string;
  /** Género gramatical del sustantivo (para «ningún canal» / «ninguna cuenta»). */
  feminine: boolean;
  /** Ruta de la guía: /guides/:guide */
  guide: GuidePlatform;
  /** El acceso caduca y la plataforma no deja renovarlo solo: se avisa antes («Caduca en N días»). */
  manualRenewal?: boolean;
  /** La plataforma no da vistas ni «me gusta»: en Resultados se muestra «—». */
  noMetrics?: boolean;
}

/** Plataformas que publican, en el orden en que se muestran. Las activas las filtra RulesService. */
export const PLATFORMS: readonly Platform[] = ['YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK', 'LINKEDIN', 'TEAMS'];

/** Plataformas que se conectan: las que publican y WhatsApp (solo bandeja). */
export const CONNECT_PLATFORMS: readonly Platform[] = [...PLATFORMS, 'WHATSAPP'];

export const PLATFORM_META: Record<Platform, IPlatformMeta> = {
  YOUTUBE: { label: 'YouTube', icon: 'youtube', text: 'text-youtube', bg: 'bg-youtube', btn: 'btn-youtube', bar: 'bg-youtube', noun: 'canal', nounPlural: 'canales', feminine: false, guide: 'youtube' },
  FACEBOOK: { label: 'Facebook', icon: 'facebook', text: 'text-facebook', bg: 'bg-facebook', btn: 'btn-facebook', bar: 'bg-facebook', noun: 'Página', nounPlural: 'Páginas', feminine: true, guide: 'facebook' },
  INSTAGRAM: { label: 'Instagram', icon: 'instagram', text: 'text-instagram', bg: 'bg-instagram', btn: 'btn-instagram', bar: 'bg-instagram', noun: 'cuenta', nounPlural: 'cuentas', feminine: true, guide: 'instagram' },
  TELEGRAM: { label: 'Telegram', icon: 'telegram', text: 'text-telegram', bg: 'bg-telegram', btn: 'btn-telegram', bar: 'bg-telegram', noun: 'canal', nounPlural: 'canales', feminine: false, guide: 'telegram' },
  TIKTOK: { label: 'TikTok', icon: 'tiktok', text: 'text-tiktok dark:text-slate-200', bg: 'bg-tiktok', btn: 'btn-tiktok', bar: 'bg-tiktok dark:bg-slate-300', noun: 'cuenta', nounPlural: 'cuentas', feminine: true, guide: 'tiktok' },
  LINKEDIN: { label: 'LinkedIn', icon: 'linkedin', text: 'text-linkedin dark:text-sky-400', bg: 'bg-linkedin', btn: 'btn-linkedin', bar: 'bg-linkedin', noun: 'cuenta', nounPlural: 'cuentas', feminine: true, guide: 'linkedin', manualRenewal: true },
  TEAMS: { label: 'Teams', icon: 'teams', text: 'text-teams dark:text-indigo-300', bg: 'bg-teams', btn: 'btn-teams', bar: 'bg-teams', noun: 'canal', nounPlural: 'canales', feminine: false, guide: 'teams', noMetrics: true },
  WHATSAPP: { label: 'WhatsApp', icon: 'whatsapp', text: 'text-whatsapp', bg: 'bg-whatsapp', btn: 'btn-whatsapp', bar: 'bg-whatsapp', noun: 'número', nounPlural: 'números', feminine: false, guide: 'whatsapp', noMetrics: true }
};

export const INBOX_KIND_META: Record<InboxKind, { label: string; icon: IconName }> = {
  DIRECT: { label: 'Privado', icon: 'message' },
  COMMENTS: { label: 'Comentarios', icon: 'broadcast' },
  GROUP: { label: 'Grupo', icon: 'user' }
};

export const INBOX_STATUS_META: Record<InboxStatus, { label: string; tone: ChipTone }> = {
  OPEN: { label: 'Abierta', tone: 'brand' },
  PENDING: { label: 'Pendiente', tone: 'warning' },
  CLOSED: { label: 'Cerrada', tone: 'outline' }
};

/** Estado de un mensaje enviado (la burbuja muestra el texto y, si hace falta, qué hacer). */
export const INBOX_MESSAGE_STATUS_META: Record<InboxMessageStatus, { label: string; tone: ChipTone }> = {
  RECEIVED: { label: 'Recibido', tone: 'neutral' },
  QUEUED: { label: 'En cola', tone: 'neutral' },
  SENDING: { label: 'Enviando…', tone: 'brand' },
  SENT: { label: 'Enviado', tone: 'success' },
  DELIVERED: { label: 'Entregado', tone: 'success' },
  READ: { label: 'Leído', tone: 'success' },
  FAILED: { label: 'Falló', tone: 'danger' },
  NEEDS_REVIEW: { label: 'Revisar', tone: 'warning' },
  CANCELLED: { label: 'Cancelado', tone: 'outline' }
};

export const INBOX_MODE_META: Record<InboxMode, { label: string; tone: ChipTone }> = {
  WEBHOOK: { label: 'Al instante (webhook)', tone: 'success' },
  POLL: { label: 'Consulta periódica', tone: 'violet' },
  NONE: { label: 'No disponible', tone: 'outline' }
};

export const PRIVACY_LABEL: Record<PrivacyStatus, string> = {
  public: 'Pública',
  unlisted: 'No listada',
  private: 'Privada',
  followers: 'Seguidores',
  friends: 'Amigos',
  connections: 'Solo mis contactos'
};

/** Visibilidad de LinkedIn: «Solo mis contactos» solo existe en perfiles personales. */
export const LINKEDIN_PRIVACY: readonly { value: PrivacyStatus; label: string }[] = [
  { value: 'public', label: 'Cualquiera' },
  { value: 'connections', label: 'Solo mis contactos' }
];

export const POST_KIND_META: Record<PostKind, { label: string; icon: IconName }> = {
  TEXT: { label: 'Texto', icon: 'text' },
  LINK: { label: 'Enlace', icon: 'link' },
  IMAGE: { label: 'Imagen', icon: 'image' },
  CAROUSEL: { label: 'Carrusel', icon: 'images' },
  VIDEO: { label: 'Video', icon: 'film' },
  DOCUMENT: { label: 'PDF', icon: 'fileText' }
};

export const MEDIA_KIND_META: Record<MediaKind, { label: string; plural: string; icon: IconName }> = {
  VIDEO: { label: 'Video', plural: 'Videos', icon: 'film' },
  IMAGE: { label: 'Imagen', plural: 'Imágenes', icon: 'image' },
  DOCUMENT: { label: 'PDF', plural: 'PDF', icon: 'fileText' }
};

/** privacy_level de TikTok → valor guardado y texto que se muestra. */
export const TIKTOK_PRIVACY: Record<string, { value: PrivacyStatus; label: string }> = {
  PUBLIC_TO_EVERYONE: { value: 'public', label: 'Todo el mundo' },
  FOLLOWER_OF_CREATOR: { value: 'followers', label: 'Seguidores' },
  MUTUAL_FOLLOW_FRIENDS: { value: 'friends', label: 'Amigos (seguidores mutuos)' },
  SELF_ONLY: { value: 'private', label: 'Solo yo' }
};

/** Parámetros con los que vuelve cada OAuth (?param=connected|reconnected|error&reason=…) y qué se conectó. */
export const OAUTH_RESULT_PARAMS: readonly { param: string; label: string }[] = [
  { param: 'youtubeAccount', label: 'Canal de YouTube' },
  { param: 'tiktokAccount', label: 'Cuenta de TikTok' },
  { param: 'linkedinAccount', label: 'Cuenta de LinkedIn' },
  { param: 'teamsAccount', label: 'Teams' }
];

/** Motivos de ?youtubeAccount|tiktokAccount|linkedinAccount=error&reason=… que devuelve el callback del OAuth. */
export const OAUTH_CONNECT_REASON: Record<string, string> = {
  access_denied: 'Cancelaste el permiso en la pantalla de inicio de sesión.',
  denied: 'La plataforma no concedió el permiso.',
  invalid_state: 'El enlace de conexión no es válido. Vuelve a intentarlo desde aquí.',
  expired: 'Pasaron más de 10 minutos en la pantalla de inicio de sesión. Vuelve a intentarlo.',
  missing_code: 'La plataforma no devolvió el código de autorización.',
  token: 'La plataforma rechazó el código de autorización. Vuelve a intentarlo.',
  missing_upload_scope: 'No marcaste el permiso para subir videos. Vuelve a conectar y déjalo marcado.',
  no_refresh_token: 'Google no entregó acceso permanente. Vuelve a conectar.',
  no_channel: 'La cuenta elegida no tiene canal o perfil. Elige la cuenta correcta.',
  not_configured: 'Falta configurar el cliente de la plataforma en Ajustes › Plataformas.',
  no_pages: 'Tu usuario no administra ninguna página de empresa en LinkedIn, o LinkedIn aún no aprobó la app de empresa.',
  missing_scope: 'No se concedieron los permisos necesarios. Vuelve a conectar y acepta todos los permisos.',
  no_teams: 'Tu cuenta no pertenece a ningún equipo de Teams.',
  admin_consent: 'Tu organización exige que un administrador apruebe la app. Abre la guía de Teams, sección «Si necesitas a TI»; mientras tanto puedes conectar canales por webhook.',
  personal_account: 'Las cuentas personales de Microsoft (outlook.com, hotmail) no sirven: entra con tu cuenta de trabajo o escuela.',
  unexpected: 'Algo falló al volver de la plataforma. Vuelve a intentarlo; si se repite, revisa la configuración en Ajustes.'
};
