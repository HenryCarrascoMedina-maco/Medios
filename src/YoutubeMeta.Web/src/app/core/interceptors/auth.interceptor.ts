import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SessionService } from '../session/session.service';

const LOGIN_URL = `${environment.apiUrl}/Auth/Login`;

/**
 * Añade el token a las llamadas a la API. Un 401 no cierra la sesión: la marca como rechazada (una
 * sola vez aunque fallen varias peticiones a la vez) y el shell pide la contraseña sin perder la
 * pantalla. Un 401 del propio login es solo «usuario o contraseña incorrectos».
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(environment.apiUrl)) return next(request);

  const session = inject(SessionService);
  const token = session.getToken();
  const authorized = token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !request.url.startsWith(LOGIN_URL)) session.markUnauthorized();
      return throwError(() => error);
    })
  );
};
