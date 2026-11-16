import { FACEBOOK_GUIDE } from './facebook.guide';
import { GuidePlatform, IGuide } from './guide.models';
import { INSTAGRAM_GUIDE } from './instagram.guide';
import { LINKEDIN_GUIDE } from './linkedin.guide';
import { TEAMS_GUIDE } from './teams.guide';
import { TELEGRAM_GUIDE } from './telegram.guide';
import { TIKTOK_GUIDE } from './tiktok.guide';
import { WHATSAPP_GUIDE } from './whatsapp.guide';
import { YOUTUBE_GUIDE } from './youtube.guide';

/** Guías por plataforma, en el orden en que se muestran. Clave = ruta /guides/:platform. */
export const GUIDES: Record<GuidePlatform, IGuide> = {
  youtube: YOUTUBE_GUIDE,
  facebook: FACEBOOK_GUIDE,
  instagram: INSTAGRAM_GUIDE,
  telegram: TELEGRAM_GUIDE,
  tiktok: TIKTOK_GUIDE,
  linkedin: LINKEDIN_GUIDE,
  teams: TEAMS_GUIDE,
  whatsapp: WHATSAPP_GUIDE
};

export { GUIDE_PLATFORM, isGuidePlatform } from './guide-loader';
