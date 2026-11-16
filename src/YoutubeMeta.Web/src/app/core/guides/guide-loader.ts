import { Platform } from '../models/api.models';
import { GuidePlatform, IGuide } from './guide.models';

/**
 * Carga diferida de cada guía (cada una es un chunk aparte). Las pantallas que solo enseñan un
 * resumen (Conexiones) no arrastran el contenido de todas las guías en su propio chunk.
 */
const LOADERS: Record<GuidePlatform, () => Promise<IGuide>> = {
  youtube: () => import('./youtube.guide').then(m => m.YOUTUBE_GUIDE),
  facebook: () => import('./facebook.guide').then(m => m.FACEBOOK_GUIDE),
  instagram: () => import('./instagram.guide').then(m => m.INSTAGRAM_GUIDE),
  telegram: () => import('./telegram.guide').then(m => m.TELEGRAM_GUIDE),
  tiktok: () => import('./tiktok.guide').then(m => m.TIKTOK_GUIDE),
  linkedin: () => import('./linkedin.guide').then(m => m.LINKEDIN_GUIDE),
  teams: () => import('./teams.guide').then(m => m.TEAMS_GUIDE),
  whatsapp: () => import('./whatsapp.guide').then(m => m.WHATSAPP_GUIDE)
};

export const GUIDE_PLATFORM: Record<GuidePlatform, Platform> = {
  youtube: 'YOUTUBE',
  facebook: 'FACEBOOK',
  instagram: 'INSTAGRAM',
  telegram: 'TELEGRAM',
  tiktok: 'TIKTOK',
  linkedin: 'LINKEDIN',
  teams: 'TEAMS',
  whatsapp: 'WHATSAPP'
};

export function isGuidePlatform(value: string | null): value is GuidePlatform {
  return value != null && value in GUIDE_PLATFORM;
}

export function loadGuide(platform: GuidePlatform): Promise<IGuide> {
  return LOADERS[platform]();
}
