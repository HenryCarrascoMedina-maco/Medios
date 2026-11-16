import { IVideo, ITemplate, ITemplateMedia, Platform } from '../models/api.models';

/** Adjunto de una plantilla como medio de la biblioteca (miniatura, tira de medios, envío). */
export function templateMediaVideo(media: ITemplateMedia): IVideo {
  return {
    id: media.mediaId,
    title: media.title,
    originalFileName: media.originalFileName,
    contentType: media.contentType,
    sizeBytes: media.sizeBytes,
    durationSec: media.durationSec,
    width: media.width,
    height: media.height,
    hasPoster: media.hasPoster,
    mediaKind: media.mediaKind,
    createdBy: media.createdBy,
    createdAt: media.createdAt,
    publications: []
  };
}

/** Adjuntos que se pueden usar (los borrados de la biblioteca se omiten), con su texto alternativo. */
export function usableTemplateMedia(template: ITemplate): { video: IVideo; alt: string }[] {
  return template.media.filter(m => !m.missing).map(m => ({ video: templateMediaVideo(m), alt: m.altText ?? '' }));
}

/** ¿Se ofrece la plantilla en esta red? (sin redes marcadas = en todas). */
export function templateOfferedOn(template: ITemplate, platform: Platform | null | undefined): boolean {
  return !platform || template.platforms.length === 0 || template.platforms.includes(platform);
}
