import { IConnection, IVideo, MediaKind, PostKind } from '../models/api.models';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'];
const DOCUMENT_EXTENSIONS = ['pdf'];

/** Tipo de un medio de la biblioteca; las respuestas antiguas (sin mediaKind) son videos. */
export function mediaKindOf(media: Pick<IVideo, 'mediaKind'> | null | undefined): MediaKind {
  return media?.mediaKind ?? 'VIDEO';
}

/** Tipo de un archivo por su extensión (antes de subirlo). */
export function mediaKindOfFile(fileName: string): MediaKind {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.includes(extension)) return 'IMAGE';
  if (DOCUMENT_EXTENSIONS.includes(extension)) return 'DOCUMENT';
  return 'VIDEO';
}

export interface IPostKindResult {
  /** null = la combinación no es válida (ver `error`). */
  kind: PostKind | null;
  error: string | null;
}

/**
 * Tipo de publicación deducido de sus medios (nunca se elige a ciegas). No se mezclan tipos, solo va
 * un video o un PDF, y un enlace solo va sin medios.
 */
export function inferPostKind(media: readonly Pick<IVideo, 'mediaKind'>[], linkUrl?: string | null): IPostKindResult {
  const link = !!linkUrl?.trim();
  if (media.length === 0) return { kind: link ? 'LINK' : 'TEXT', error: null };
  if (link) return { kind: null, error: 'un enlace solo puede ir en una publicación sin medios' };

  const kinds = new Set(media.map(mediaKindOf));
  if (kinds.size > 1) return { kind: null, error: 'no se pueden mezclar videos, imágenes y PDF en la misma publicación' };
  switch ([...kinds][0]) {
    case 'IMAGE': return { kind: media.length === 1 ? 'IMAGE' : 'CAROUSEL', error: null };
    case 'VIDEO': return media.length === 1 ? { kind: 'VIDEO', error: null } : { kind: null, error: 'solo cabe un video por publicación' };
    case 'DOCUMENT': return media.length === 1 ? { kind: 'DOCUMENT', error: null } : { kind: null, error: 'solo cabe un PDF por publicación' };
  }
}

/** Dirección web válida para una publicación de enlace (http o https). */
export function isValidLink(value: string | null | undefined): boolean {
  const text = value?.trim();
  if (!text) return false;
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

/** Dominio que se enseña en la tarjeta del enlace («ejemplo.com»). */
export function linkHost(value: string | null | undefined): string {
  try {
    return new URL(value ?? '').hostname.replace(/^www\./, '');
  } catch {
    return value ?? '';
  }
}

/** Canal de Teams conectado por webhook (Workflows) en lugar de con Graph. */
export function isTeamsWebhook(account: Pick<IConnection, 'platform' | 'externalId'>): boolean {
  return account.platform === 'TEAMS' && account.externalId.startsWith('webhook:');
}

/**
 * Cuenta de LinkedIn que es una página de empresa (el servidor lo indica en accountHint, o el id es
 * un URN de organización). Las páginas solo publican para «Cualquiera».
 */
export function isLinkedinPage(account: Pick<IConnection, 'platform' | 'accountHint' | 'externalId'>): boolean {
  return account.platform === 'LINKEDIN'
    && ((account.accountHint ?? '').toLowerCase().includes('empresa') || account.externalId.includes('organization'));
}
