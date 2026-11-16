import { PublicationStatus } from '../models/api.models';

/** Estados finales que merecen una notificación del navegador. */
export const NOTIFY_STATUSES: readonly PublicationStatus[] = ['DONE', 'FAILED', 'NEEDS_REVIEW'];

/** Título y cuerpo de la notificación de una publicación terminada (null = no se avisa). */
export function publishNotificationText(status: PublicationStatus, platform: string, videoTitle: string | null): { title: string; body: string } | null {
  const video = videoTitle ? `«${videoTitle}»` : 'El video';
  switch (status) {
    case 'DONE': return { title: `Publicado en ${platform}`, body: `${video} ya está publicado.` };
    case 'FAILED': return { title: `Falló la publicación en ${platform}`, body: `${video} no se pudo publicar. Ábrelo para ver el motivo.` };
    case 'NEEDS_REVIEW': return { title: `Revisa la publicación en ${platform}`, body: `No se pudo confirmar si ${video.charAt(0).toLowerCase() + video.slice(1)} se publicó.` };
    default: return null;
  }
}
