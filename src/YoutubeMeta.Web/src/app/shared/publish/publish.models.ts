import { IConnection, IPostMedia, IPublicationCreate, IPublicationDestination, IPublicationRules, ITiktokCreatorInfo, IVideo, Platform, PostKind, PrivacyStatus, TiktokMode } from '@core/models/api.models';
import { toLocalInput, utf8Bytes } from '@core/utils/format';
import { isLinkedinPage, isTeamsWebhook } from '@core/utils/post-kind';
import { capabilityOf, destinationErrors, hashtagCount, publicationRules, telegramCaption, youtubeTagsLength } from '@core/utils/publication-rules';
import { resolveTemplate } from '@core/utils/template-vars';

/** Ajustes de una cuenta. title/description en null = usa el texto común. */
export interface IDraft {
  title: string | null;
  description: string | null;
  tags: string;
  categoryId: string;
  privacy: PrivacyStatus | null;
  publishAt: string;
  notify: boolean;
  shareToFeed: boolean;
  disableNotification: boolean;
  protectContent: boolean;
  tiktokMode: TiktokMode;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  commercial: boolean;
  brandOrganic: boolean;
  brandContent: boolean;
  /** YouTube: lista de reproducción donde se añade (vacío = ninguna). */
  playlistId: string;
  /** Comentario propio justo después de publicar (solo si la plataforma lo admite). */
  firstComment: string;
  /** Teams (Graph): avisar a todo el canal con @canal. */
  teamsMentionChannel: boolean;
}

export interface IMediaItem {
  video: IVideo;
  alt: string;
}

/** Estado de creator_info de cada cuenta de TikTok: lo exige TikTok antes de mostrar el formulario. */
export type TiktokInfoState = ITiktokCreatorInfo | 'loading' | { error: string };

/** Lo común a todas las cuentas del diálogo para una publicación. */
export interface IPublishContext {
  /** Medios en orden (vacío = texto o enlace). */
  media: readonly IVideo[];
  kind: PostKind;
  title: string;
  description: string;
  madeForKids: boolean;
  synthetic: boolean | null;
  now: number;
  /** Sin ellas, las reglas por defecto. */
  rules?: IPublicationRules;
}

export function newDraft(): IDraft {
  return {
    title: null,
    description: null,
    tags: '',
    categoryId: '',
    privacy: null,
    publishAt: '',
    notify: true,
    shareToFeed: true,
    disableNotification: false,
    protectContent: false,
    tiktokMode: 'DIRECT',
    disableComment: false,
    disableDuet: false,
    disableStitch: false,
    commercial: false,
    brandOrganic: false,
    brandContent: false,
    playlistId: '',
    firstComment: '',
    teamsMentionChannel: false
  };
}

/** Fecha de la publicación `index` en una serie: la de la cuenta + index × intervalo. Vacío = sin programar. */
export function staggeredPublishAt(base: string, index: number, intervalMs: number): string {
  if (!base || index === 0 || intervalMs <= 0) return base;
  return toLocalInput(new Date(new Date(base).getTime() + index * intervalMs));
}

/**
 * Texto final de una cuenta: el propio o el común, con variables y bloques resueltos. {titulo} es el
 * título del primer medio (vacío en publicaciones sin medios).
 */
export function finalText(
  d: Pick<IDraft, 'title' | 'description' | 'publishAt'>,
  common: { title: string; description: string },
  vars: {
    video: IVideo | null;
    signature: string | null | undefined;
    /** {cuenta} */
    account?: string | null;
    blocks: Readonly<Record<string, string>>;
    /** {?campo} */
    fields?: Readonly<Record<string, string>>;
    now: number;
  }
): { title: string; description: string } {
  const ctx = {
    title: vars.video?.title ?? '', date: d.publishAt ? new Date(d.publishAt) : new Date(vars.now), signature: vars.signature,
    account: vars.account, blocks: vars.blocks, fields: vars.fields
  };
  return { title: resolveTemplate(d.title ?? common.title, ctx), description: resolveTemplate(d.description ?? common.description, ctx) };
}

export function tiktokInfoOf(state: TiktokInfoState | undefined): ITiktokCreatorInfo | null {
  return state && state !== 'loading' && !('error' in state) ? state : null;
}

export function tiktokErrorOf(state: TiktokInfoState | undefined): string | null {
  return state && state !== 'loading' && 'error' in state ? state.error : null;
}

export const effectiveTitle = (d: IDraft, ctx: IPublishContext): string => d.title ?? ctx.title;
export const effectiveDescription = (d: IDraft, ctx: IPublishContext): string => d.description ?? ctx.description;

/** Visibilidad que se envía a LinkedIn (por defecto, «Cualquiera»). */
const linkedinPrivacy = (d: IDraft): PrivacyStatus => d.privacy ?? 'public';

/** Capacidad de la cuenta (un canal de Teams por webhook tiene la suya). */
export function accountCapability(account: IConnection, rules: IPublicationRules = publicationRules()) {
  return capabilityOf(account.platform, rules, isTeamsWebhook(account));
}

/** El primer comentario solo se envía si la cuenta lo admite. */
function firstCommentOf(account: IConnection, d: IDraft, ctx: IPublishContext): string {
  return accountCapability(account, ctx.rules ?? publicationRules()).firstComment ? d.firstComment.trim() : '';
}

/** Errores de una cuenta, con el mismo cálculo que la API (vacío = se puede publicar). */
export function draftErrors(account: IConnection, d: IDraft, ctx: IPublishContext, tiktok: TiktokInfoState | undefined): string[] {
  const info = tiktokInfoOf(tiktok);
  const scheduled = d.publishAt ? new Date(d.publishAt) : null;
  const video = ctx.kind === 'VIDEO' ? ctx.media[0] : null;
  const extra = account.platform === 'TIKTOK' && d.tiktokMode === 'DIRECT' && d.commercial && !d.brandOrganic && !d.brandContent
    ? ['indica de quién es el contenido comercial'] : [];
  return extra.concat(destinationErrors({
    platform: account.platform,
    title: effectiveTitle(d, ctx),
    description: effectiveDescription(d, ctx),
    tags: d.tags,
    categoryId: d.categoryId,
    privacy: account.platform === 'YOUTUBE' && scheduled ? 'private' : account.platform === 'LINKEDIN' ? linkedinPrivacy(d) : d.privacy,
    publishAt: scheduled,
    madeForKids: ctx.madeForKids,
    synthetic: ctx.synthetic,
    tiktokInbox: d.tiktokMode === 'INBOX',
    brandContent: d.commercial && d.brandContent,
    sizeBytes: video?.sizeBytes ?? 0,
    durationSec: video?.durationSec ?? null,
    uploadLimitMb: account.uploadLimitMb,
    tiktokPrivacyOptions: info?.privacyOptions ?? (tiktokErrorOf(tiktok) ? [] : null),
    tiktokMaxDurationSec: info?.maxDurationSec ?? null,
    kind: ctx.kind,
    media: ctx.media,
    firstComment: d.firstComment,
    linkedinPage: isLinkedinPage(account),
    teamsWebhook: isTeamsWebhook(account)
  }, ctx.now, ctx.rules ?? publicationRules()));
}

export function toDestination(account: IConnection, d: IDraft, ctx: IPublishContext): IPublicationDestination {
  const platform = account.platform;
  const publishAt = d.publishAt ? new Date(d.publishAt).toISOString() : null;
  const isTiktokDirect = platform === 'TIKTOK' && d.tiktokMode === 'DIRECT';
  const firstComment = firstCommentOf(account, d, ctx);
  const comment = firstComment ? { firstComment } : null;
  return {
    connectionId: account.id,
    title: effectiveTitle(d, ctx).trim(),
    description: effectiveDescription(d, ctx) || null,
    tags: platform === 'YOUTUBE' ? d.tags.trim() || null : null,
    categoryId: platform === 'YOUTUBE' ? d.categoryId : null,
    privacyStatus: platform === 'YOUTUBE' ? (publishAt ? 'private' : d.privacy) : isTiktokDirect ? d.privacy
      : platform === 'LINKEDIN' ? linkedinPrivacy(d) : platform === 'TEAMS' ? 'public' : null,
    publishAt,
    madeForKids: platform === 'YOUTUBE' ? ctx.madeForKids : null,
    containsSyntheticMedia: platform === 'YOUTUBE' || platform === 'TIKTOK' ? ctx.synthetic ?? false : null,
    notifySubscribers: d.notify,
    options:
      platform === 'INSTAGRAM' ? { shareToFeed: d.shareToFeed, ...comment }
      : platform === 'YOUTUBE' ? (d.playlistId ? { playlistId: d.playlistId } : null)
      : platform === 'TELEGRAM' ? { disableNotification: d.disableNotification, protectContent: d.protectContent }
      : platform === 'TEAMS' ? (isTeamsWebhook(account) ? comment : { ...comment, teamsMentionChannel: d.teamsMentionChannel })
      : platform === 'TIKTOK' ? {
          tiktokMode: d.tiktokMode,
          disableComment: d.disableComment,
          disableDuet: d.disableDuet,
          disableStitch: d.disableStitch,
          brandOrganic: d.commercial && d.brandOrganic,
          brandContent: d.commercial && d.brandContent,
          isAigc: ctx.synthetic ?? false
        }
      : comment
  };
}

/** Cuerpo de POST /api/Publication: medios en orden (con su texto alternativo) o, sin medios, el enlace. */
export function toPublicationRequest(
  media: readonly IMediaItem[], linkUrl: string, title: string, consent: boolean, destinations: IPublicationDestination[]
): IPublicationCreate {
  const items: IPostMedia[] = media.map(m => (m.alt.trim() ? { id: m.video.id, alt: m.alt.trim() } : { id: m.video.id }));
  const link = media.length === 0 && linkUrl.trim() ? { linkUrl: linkUrl.trim() } : {};
  return { media: items, ...link, ...(title.trim() ? { title: title.trim() } : {}), consent, destinations };
}

export function draftCounters(platform: Platform, d: IDraft, ctx: IPublishContext): string {
  const title = effectiveTitle(d, ctx);
  const description = effectiveDescription(d, ctx);
  const r = ctx.rules ?? publicationRules();
  const textOnly = ctx.kind === 'TEXT' || ctx.kind === 'LINK';
  switch (platform) {
    case 'YOUTUBE': return `título ${title.length}/${r.youtubeTitleMax} · descripción ${utf8Bytes(description)}/${r.youtubeDescriptionMaxBytes} bytes · etiquetas ${youtubeTagsLength(d.tags)}/${r.youtubeTagsMax}`;
    case 'INSTAGRAM': return `texto ${description.length}/${r.instagramCaptionMax} · hashtags ${hashtagCount(description)}/${r.instagramHashtagsMax}`;
    case 'TELEGRAM': return `texto ${telegramCaption(title, description).length}/${textOnly ? capabilityOf('TELEGRAM', r).textMax ?? r.telegramTextMax : r.telegramCaptionMax}`;
    case 'TIKTOK': return `texto ${title.length}/${r.tiktokTitleMax}`;
    case 'LINKEDIN': return `texto ${description.length}/${r.linkedinTextMax}`;
    case 'TEAMS': return `asunto ${title.length}/${r.titleMax} · texto ${description.length}/${capabilityOf('TEAMS', r).textMax ?? '—'}`;
    default: return `título ${title.length}/${r.titleMax}`;
  }
}

/** Lo que LinkedIn enseña antes de «…ver más» (aprox.). */
export const LINKEDIN_FOLD = 210;

/** Corta el texto en `fold` caracteres sin partir palabras si se puede, como LinkedIn antes de «…ver más». */
export function foldText(text: string, fold = LINKEDIN_FOLD): { shown: string; more: boolean } {
  if (text.length <= fold) return { shown: text, more: false };
  const cut = text.slice(0, fold);
  const space = cut.lastIndexOf(' ');
  return { shown: (space > fold * 0.6 ? cut.slice(0, space) : cut).trimEnd(), more: true };
}
