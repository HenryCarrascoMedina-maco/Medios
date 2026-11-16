import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { GUIDE_PLATFORM, isGuidePlatform } from '../guides/guide-loader';
import { RulesService } from '../services/rules.service';

/** La guía de una plataforma desactivada en esta instalación (p. ej. LinkedIn) lleva a la primera guía. */
export const enabledGuideGuard: CanActivateFn = async route => {
  // inject() solo vale antes del primer await.
  const rules = inject(RulesService);
  const router = inject(Router);
  await rules.ensure();
  const platform = route.paramMap.get('platform');
  return isGuidePlatform(platform) && !rules.isEnabled(GUIDE_PLATFORM[platform]) ? router.createUrlTree(['/guides', 'youtube']) : true;
};
