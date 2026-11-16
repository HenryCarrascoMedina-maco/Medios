import { PLATFORMS, PLATFORM_META, POST_KIND_META } from '../constants/status.constants';
import { IPlatformCapability, IPublicationRules, IVideo, Platform, PostKind, PrivacyStatus } from '../models/api.models';
import { addMonths } from './dates';
import { utf8Bytes } from './format';
import { mediaKindOf } from './post-kind';

/** Capacidades mientras no llega /Rules (o si falla): solo videos. Lo que admite cada plataforma lo dice el servidor. */
export const DEFAULT_CAPABILITY: Omit<IPlatformCapability, 'platform'> = {
  kinds: ['VIDEO'],
  maxImages: 0,
  imageMaxBytes: 0,
  imageTypes: [],
  imagesNeedPublicUrl: false,
  firstComment: false,
  textMax: null,
  documentMaxBytes: null
};

const defaultPlatforms = (): Record<Platform, IPlatformCapability> =>
  Object.fromEntries(PLATFORMS.map(platform => [platform, { platform, ...DEFAULT_CAPABILITY }])) as Record<Platform, IPlatformCapability>;

/**
 * Valores por defecto de las reglas (iguales a PublicationRules.cs). Solo se usan hasta que llega
 * GET /api/Publication/Rules o si esa llamada falla: la fuente de verdad es el servidor.
 */
export const DEFAULT_RULES: IPublicationRules = {
  titleMax: 255,
  youtubeTitleMax: 100,
  youtubeDescriptionMaxBytes: 5000,
  youtubeTagsMax: 500,
  facebookTitleMax: 255,
  facebookDescriptionMax: 5000,
  facebookScheduleMinMinutes: 10,
  instagramCaptionMax: 2200,
  instagramHashtagsMax: 30,
  instagramMentionsMax: 20,
  instagramMaxBytes: 300 * 1024 * 1024,
  instagramMinSeconds: 3,
  instagramMaxSeconds: 15 * 60,
  telegramCaptionMax: 1024,
  tiktokTitleMax: 2200,
  tiktokMaxBytes: 4 * 1024 * 1024 * 1024,
  scheduleMaxMonths: 6,
  linkedinTitleMax: 200,
  linkedinTextMax: 3000,
  linkedinVideoMaxBytes: 5 * 1024 * 1024 * 1024,
  telegramTextMax: 4096,
  firstCommentMax: 1250,
  maxMedia: 35,
  publicMediaAvailable: false,
  platforms: defaultPlatforms(),
  teamsWebhook: { platform: 'TEAMS', ...DEFAULT_CAPABILITY },
  // Hasta que conteste el servidor, ninguna: así nunca asoma una plataforma desactivada (p. ej. LinkedIn).
  enabledPlatforms: []
};

/** Sin verificar por teléfono, YouTube no admite más de 15 min (no viene en /Rules: es del canal). */
export const YOUTUBE_UNVERIFIED_MAX_SECONDS = 15 * 60;
/** Límite del servidor público de Telegram; un bot con servidor propio indica el suyo (uploadLimitMb). */
export const TELEGRAM_CLOUD_MAX_MB = 50;

let current: IPublicationRules = DEFAULT_RULES;

/** Reglas vigentes (las del servidor si ya llegaron). */
export function publicationRules(): IPublicationRules {
  return current;
}

/** Aplica las reglas del servidor; los campos que falten conservan el valor por defecto. */
export function setPublicationRules(rules: Partial<IPublicationRules> | null): void {
  const platforms = defaultPlatforms();
  for (const [platform, capability] of Object.entries(rules?.platforms ?? {}) as [Platform, Partial<IPlatformCapability>][])
    platforms[platform] = { ...platforms[platform], ...capability, platform };
  const teamsWebhook: IPlatformCapability = { ...DEFAULT_RULES.teamsWebhook, ...(rules?.teamsWebhook ?? {}), platform: 'TEAMS' };
  current = { ...DEFAULT_RULES, ...(rules ?? {}), platforms, teamsWebhook };
}

/**
 * Lo que admite una plataforma según las reglas vigentes. `webhook` = canal de Teams conectado por
 * webhook, que tiene su propia capacidad (teamsWebhook).
 */
export function capabilityOf(platform: Platform, r: IPublicationRules = current, webhook = false): IPlatformCapability {
  if (platform === 'TEAMS' && webhook) return r.teamsWebhook ?? { platform, ...DEFAULT_CAPABILITY };
  return r.platforms?.[platform] ?? { platform, ...DEFAULT_CAPABILITY };
}

/** Motivo de un canal de Teams por webhook que no admite el tipo de publicación. */
export const TEAMS_WEBHOOK_REASON = 'Un canal conectado por webhook solo admite texto, enlace e imágenes por dirección pública';

/** Un medio de la publicación, con lo necesario para validarlo. */
export type IMediaCheck = Pick<IVideo, 'title' | 'contentType' | 'sizeBytes' | 'mediaKind'>;

/** La publicación (tipo y medios), común a todas las cuentas. */
export interface IPostCheck {
  kind: PostKind;
  media: readonly IMediaCheck[];
}

/** Lo que se va a publicar en una cuenta, ya con el texto común aplicado. */
export interface IDestinationCheck {
  platform: Platform;
  title: string;
  description: string;
  tags: string;
  categoryId: string;
  privacy: PrivacyStatus | null;
  publishAt: Date | null;
  madeForKids: boolean;
  synthetic: boolean | null;
  tiktokInbox: boolean;
  brandContent: boolean;
  sizeBytes: number;
  durationSec: number | null;
  uploadLimitMb: number | null;
  tiktokPrivacyOptions: string[] | null;
  tiktokMaxDurationSec: number | null;
  /** Tipo de publicación; sin indicar = VIDEO (con sizeBytes/durationSec del video). */
  kind?: PostKind;
  media?: readonly IMediaCheck[];
  firstComment?: string;
  /** LinkedIn: la cuenta es una página de empresa (solo admite «Cualquiera»). */
  linkedinPage?: boolean;
  /** Teams: canal conectado por webhook (capacidad teamsWebhook). */
  teamsWebhook?: boolean;
}

export function splitTags(tags: string | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of (tags ?? '').split(',')) {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (tag.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

/** Como lo cuenta YouTube: las comas suman y una etiqueta con espacios lleva comillas (+2). */
export function youtubeTagsLength(tags: string | null | undefined): number {
  const list = splitTags(tags);
  if (list.length === 0) return 0;
  return list.reduce((total, tag) => total + tag.length + (tag.includes(' ') ? 2 : 0), 0) + list.length - 1;
}

export function hasAngleBrackets(value: string | null | undefined): boolean {
  return !!value && /[<>]/.test(value);
}

export function hashtagCount(text: string | null | undefined): number {
  return (text ?? '').match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
}

export function mentionCount(text: string | null | undefined): number {
  return (text ?? '').match(/(^|\s)@[\p{L}\p{N}_.]+/gu)?.length ?? 0;
}

/** Texto que acompaña al video en Telegram: la descripción o, si está vacía, el título. */
export function telegramCaption(title: string, description: string): string {
  return description.trim() ? description : title;
}

const MB = 1024 * 1024;
const sizeText = (bytes: number) => (bytes >= 1024 * MB ? `${Math.round(bytes / (1024 * MB))} GB` : `${Math.round(bytes / MB)} MB`);
const durationText = (seconds: number) => (seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`);

/** Motivo de Instagram/TikTok sin dominio público (no pueden descargar las imágenes). */
export const PUBLIC_URL_REASON = 'necesita que la app esté publicada en un dominio (dirección pública)';

/** Tipos sin medios: el texto es obligatorio. */
const TEXT_ONLY: readonly PostKind[] = ['TEXT', 'LINK'];
/** Tipos en los que el título da nombre al archivo y es obligatorio. */
const TITLED: readonly PostKind[] = ['VIDEO', 'DOCUMENT'];

/**
 * Por qué una cuenta no puede recibir esta publicación, con independencia del texto (tipo, número
 * de imágenes, formatos, tamaños o dominio público). Vacío = disponible. El diálogo lo enseña junto a
 * cada cuenta para que se sepa el motivo antes de elegirla.
 */
export function postBlockers(platform: Platform, post: IPostCheck, r: IPublicationRules = current, webhook = false): string[] {
  const label = PLATFORM_META[platform].label;
  const cap = capabilityOf(platform, r, webhook);
  if (!cap.kinds.includes(post.kind) || (platform === 'YOUTUBE' && post.kind !== 'VIDEO'))
    return [platform === 'TEAMS' && webhook ? TEAMS_WEBHOOK_REASON : `${label} no admite publicaciones de tipo ${POST_KIND_META[post.kind].label.toLowerCase()}`];

  const blockers: string[] = [];
  const images = post.media.filter(m => mediaKindOf(m) === 'IMAGE');
  if (images.length) {
    if (images.length > cap.maxImages) blockers.push(`${label} admite hasta ${cap.maxImages} ${cap.maxImages === 1 ? 'imagen' : 'imágenes'}`);
    if (platform === 'TELEGRAM' && post.kind === 'CAROUSEL' && images.length < 2) blockers.push('un álbum de Telegram necesita al menos 2 imágenes');
    const badType = images.find(m => !cap.imageTypes.includes(m.contentType.toLowerCase()));
    if (badType) blockers.push(`${label} no admite imágenes ${badType.contentType.replace('image/', '').toUpperCase()}`);
    const tooBig = images.find(m => m.sizeBytes > cap.imageMaxBytes);
    if (tooBig) blockers.push(`imagen «${tooBig.title}» de más de ${sizeText(cap.imageMaxBytes)}`);
    if (cap.imagesNeedPublicUrl && !r.publicMediaAvailable) blockers.push(PUBLIC_URL_REASON);
  }

  const limit = cap.documentMaxBytes;
  if (limit != null && post.media.some(m => mediaKindOf(m) === 'DOCUMENT' && m.sizeBytes > limit)) blockers.push(`PDF de más de ${sizeText(limit)}`);
  return blockers;
}

/** Errores de una cuenta de destino (vacío = se puede publicar). */
export function destinationErrors(d: IDestinationCheck, now = Date.now(), r: IPublicationRules = current): string[] {
  const kind = d.kind ?? 'VIDEO';
  const isVideo = kind === 'VIDEO';
  const textOnly = TEXT_ONLY.includes(kind);
  const cap = capabilityOf(d.platform, r, d.teamsWebhook);
  const errors = postBlockers(d.platform, { kind, media: d.media ?? [] }, r, d.teamsWebhook);
  // Si el tipo no cabe en la plataforma, lo demás no importa.
  if (errors.length && (!cap.kinds.includes(kind) || (d.platform === 'YOUTUBE' && !isVideo))) return errors;

  if (TITLED.includes(kind) && !d.title.trim()) errors.push('falta el título');
  if (d.title.length > r.titleMax) errors.push(`título de más de ${r.titleMax}`);
  const body = d.platform === 'TELEGRAM' ? telegramCaption(d.title, d.description) : d.description;
  if (textOnly && !body.trim()) errors.push('falta el texto');
  if (textOnly && cap.textMax != null && body.length > cap.textMax) errors.push(`texto de más de ${cap.textMax}`);
  const comment = d.firstComment?.trim() ?? '';
  if (comment && !cap.firstComment)
    errors.push(d.platform === 'TEAMS' && d.teamsWebhook ? 'un canal por webhook no admite primera respuesta' : `${PLATFORM_META[d.platform].label} no admite primer comentario`);
  else if (comment.length > r.firstCommentMax) errors.push(`primer comentario de más de ${r.firstCommentMax}`);
  const at = d.publishAt?.getTime() ?? null;
  const tooFar = at != null && at > addMonths(new Date(now), r.scheduleMaxMonths).getTime();
  const farText = `máximo ${r.scheduleMaxMonths} meses`;

  switch (d.platform) {
    case 'YOUTUBE':
      if (d.title.length > r.youtubeTitleMax) errors.push(`título de más de ${r.youtubeTitleMax}`);
      if (hasAngleBrackets(d.title) || hasAngleBrackets(d.description)) errors.push('no se permiten < ni >');
      if (utf8Bytes(d.description) > r.youtubeDescriptionMaxBytes) errors.push(`descripción de más de ${r.youtubeDescriptionMaxBytes} bytes`);
      if (youtubeTagsLength(d.tags) > r.youtubeTagsMax) errors.push(`etiquetas de más de ${r.youtubeTagsMax}`);
      if (!d.categoryId) errors.push('elige la categoría');
      if (!d.privacy) errors.push('elige la visibilidad');
      if (d.synthetic == null) errors.push('indica si contiene IA');
      if (at != null && at <= now) errors.push('la fecha debe ser futura');
      break;

    case 'FACEBOOK':
      if (d.title.length > r.facebookTitleMax) errors.push(`título de más de ${r.facebookTitleMax}`);
      if (!textOnly && d.description.length > r.facebookDescriptionMax) errors.push(`descripción de más de ${r.facebookDescriptionMax}`);
      if (at != null && at < now + r.facebookScheduleMinMinutes * 60_000) errors.push(`mínimo ${r.facebookScheduleMinMinutes} minutos desde ahora`);
      if (tooFar) errors.push(farText);
      break;

    case 'INSTAGRAM':
      if (d.description.length > r.instagramCaptionMax) errors.push(`texto de más de ${r.instagramCaptionMax}`);
      if (hashtagCount(d.description) > r.instagramHashtagsMax) errors.push(`más de ${r.instagramHashtagsMax} hashtags`);
      if (mentionCount(d.description) > r.instagramMentionsMax) errors.push(`más de ${r.instagramMentionsMax} menciones`);
      if (isVideo && d.sizeBytes > r.instagramMaxBytes) errors.push(`más de ${sizeText(r.instagramMaxBytes)}`);
      if (isVideo && d.durationSec != null && (d.durationSec < r.instagramMinSeconds || d.durationSec > r.instagramMaxSeconds))
        errors.push(`debe durar de ${durationText(r.instagramMinSeconds)} a ${durationText(r.instagramMaxSeconds)}`);
      jobSchedule(errors, at, now, tooFar, farText);
      break;

    case 'TELEGRAM': {
      const limitMb = d.uploadLimitMb ?? TELEGRAM_CLOUD_MAX_MB;
      // Sin medios es un mensaje (telegramTextMax); con medios, el pie del archivo (telegramCaptionMax).
      if (!textOnly && body.length > r.telegramCaptionMax) errors.push(`texto de más de ${r.telegramCaptionMax}`);
      if (textOnly && cap.textMax == null && body.length > r.telegramTextMax) errors.push(`texto de más de ${r.telegramTextMax}`);
      const sizes = d.media?.length ? d.media.map(m => m.sizeBytes) : [d.sizeBytes];
      if (!textOnly && sizes.some(size => size > limitMb * MB)) errors.push(`el bot admite hasta ${limitMb} MB`);
      jobSchedule(errors, at, now, tooFar, farText);
      break;
    }

    case 'TIKTOK':
      if (d.title.length > r.tiktokTitleMax) errors.push(`texto de más de ${r.tiktokTitleMax}`);
      if (isVideo && d.sizeBytes > r.tiktokMaxBytes) errors.push(`más de ${sizeText(r.tiktokMaxBytes)}`);
      if (!d.tiktokInbox) {
        if (d.tiktokPrivacyOptions == null) errors.push('cargando los datos de la cuenta');
        if (!d.privacy) errors.push('elige quién puede verlo');
        if (d.brandContent && d.privacy === 'private') errors.push('el contenido de marca no puede ser privado');
        if (d.tiktokMaxDurationSec && d.durationSec != null && d.durationSec > d.tiktokMaxDurationSec)
          errors.push(`la cuenta admite hasta ${Math.floor(d.tiktokMaxDurationSec / 60)} min`);
      }
      jobSchedule(errors, at, now, tooFar, farText);
      break;

    case 'LINKEDIN':
      if (d.title.length > r.linkedinTitleMax) errors.push(`título de más de ${r.linkedinTitleMax}`);
      if (d.description.length > r.linkedinTextMax) errors.push(`texto de más de ${r.linkedinTextMax}`);
      if (isVideo && d.sizeBytes > r.linkedinVideoMaxBytes) errors.push(`más de ${sizeText(r.linkedinVideoMaxBytes)}`);
      if (d.privacy === 'connections' && d.linkedinPage) errors.push('una página de empresa solo publica para «Cualquiera»');
      jobSchedule(errors, at, now, tooFar, farText);
      break;

    case 'TEAMS':
      // El límite del mensaje vale también con medios (sin medios ya lo comprobó la regla común).
      if (!textOnly && cap.textMax != null && d.description.length > cap.textMax) errors.push(`texto de más de ${cap.textMax}`);
      jobSchedule(errors, at, now, tooFar, farText);
      break;
  }
  return errors;
}

function jobSchedule(errors: string[], at: number | null, now: number, tooFar: boolean, farText: string): void {
  if (at != null && at <= now) errors.push('la fecha debe ser futura');
  if (tooFar) errors.push(farText);
}

/** Límite de texto de cada plataforma (para contadores y vista previa). */
export function textLimits(platform: Platform, r: IPublicationRules = current, textOnly = false): { title: number; description: number } {
  switch (platform) {
    case 'YOUTUBE': return { title: r.youtubeTitleMax, description: r.youtubeDescriptionMaxBytes };
    case 'FACEBOOK': return { title: r.facebookTitleMax, description: r.facebookDescriptionMax };
    case 'INSTAGRAM': return { title: r.titleMax, description: r.instagramCaptionMax };
    case 'TELEGRAM': return { title: r.titleMax, description: textOnly ? capabilityOf('TELEGRAM', r).textMax ?? r.telegramTextMax : r.telegramCaptionMax };
    case 'TIKTOK': return { title: r.tiktokTitleMax, description: r.tiktokTitleMax };
    case 'LINKEDIN': return { title: r.linkedinTitleMax, description: r.linkedinTextMax };
    case 'TEAMS': return { title: r.titleMax, description: capabilityOf('TEAMS', r).textMax ?? Number.MAX_SAFE_INTEGER };
    // WhatsApp no publica (solo bandeja).
    case 'WHATSAPP': return { title: 0, description: 0 };
  }
}
