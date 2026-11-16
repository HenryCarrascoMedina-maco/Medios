import { IPublishUpdate, PublicationStatus } from '../models/api.models';

/** Lo mínimo de una publicación para decidir qué acciones admite (IPublication o el panel del detalle). */
export interface IPublicationState {
  statusCode: PublicationStatus;
  isSending?: boolean;
}

/** Mismas reglas que el back (Retry): falló, espera cuota o espera reconexión. */
export function canRetry(p: IPublicationState | null | undefined): boolean {
  return p != null && (p.statusCode === 'FAILED' || p.statusCode === 'WAITING_QUOTA' || p.statusCode === 'NEEDS_RECONNECT');
}

/** Se puede cancelar mientras no se esté enviando: en cola, esperando, por revisar o subida interrumpida. */
export function canCancel(p: IPublicationState | null | undefined): boolean {
  if (p == null) return false;
  return p.statusCode === 'PENDING' || p.statusCode === 'WAITING_QUOTA' || p.statusCode === 'NEEDS_RECONNECT' || p.statusCode === 'NEEDS_REVIEW'
    || (p.statusCode === 'UPLOADING' && !p.isSending);
}

/** NEEDS_REVIEW: no se sabe si la plataforma lo publicó; se marca como hecho o se sube de nuevo. */
export function canResolve(p: IPublicationState | null | undefined): boolean {
  return p?.statusCode === 'NEEDS_REVIEW';
}

/** «Subir de nuevo desde cero» (REUPLOAD): por revisar o falló. */
export function canReupload(p: IPublicationState | null | undefined): boolean {
  return p?.statusCode === 'NEEDS_REVIEW' || p?.statusCode === 'FAILED';
}

/** Aplica un progreso en vivo (SignalR) a la publicación de la lista que corresponde. */
export function withProgress<T extends IPublicationState & { id: number; percent: number | null }>(list: readonly T[], u: IPublishUpdate): T[] {
  return list.map(p => p.id === u.publicationId ? { ...p, statusCode: u.status, percent: u.percent, isSending: true } : p);
}
