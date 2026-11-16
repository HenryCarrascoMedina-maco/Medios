import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthHttp } from '../http/api.http';
import { SessionService } from './session.service';

/**
 * Mantiene viva la sesión sin perder lo que hay en pantalla: renueva el token o reautentica con la
 * contraseña. Las subidas TUS reaccionan solas al cambio de sesión (ver VideoUploadService).
 */
@Injectable({ providedIn: 'root' })
export class SessionKeeperService {
  private readonly auth = inject(AuthHttp);
  private readonly session = inject(SessionService);

  /** «Seguir conectado»: nuevo token con el actual (POST /api/Auth/Refresh). */
  async refresh(): Promise<void> {
    this.session.start(await firstValueFrom(this.auth.refresh()));
  }

  /** Sesión caducada o rechazada: entra de nuevo con el mismo usuario. */
  async reauthenticate(password: string): Promise<void> {
    const user = this.session.user();
    if (!user) throw new Error('Sin usuario');
    this.session.start(await firstValueFrom(this.auth.login(user.userName, password)));
  }
}
