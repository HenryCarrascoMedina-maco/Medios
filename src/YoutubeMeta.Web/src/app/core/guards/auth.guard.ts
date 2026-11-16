import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../session/session.service';

/**
 * Deja pasar con sesión válida o pendiente de reautenticar (el shell muestra el diálogo de
 * contraseña sin perder la pantalla). Sin usuario, al login.
 */
export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return session.user() != null ? true : inject(Router).createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return session.isAuthenticated() ? inject(Router).createUrlTree(['/']) : true;
};
