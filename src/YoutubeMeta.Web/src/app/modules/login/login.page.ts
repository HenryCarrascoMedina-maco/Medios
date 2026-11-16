import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthHttp } from '@core/http/api.http';
import { SessionService } from '@core/session/session.service';
import { apiError } from '@core/utils/format';
import { IconComponent } from '@shared/ui/icon.component';
import { ReqComponent } from '@shared/ui/req.component';

@Component({
  selector: 'ym-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ReqComponent],
  template: `
    <div class="grid min-h-screen place-items-center bg-gradient-to-br from-navy-light to-navy px-4">
      <form class="card w-full max-w-sm p-6" (ngSubmit)="submit()">
        <div class="mb-6 flex items-center gap-3">
          <span class="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand to-brand-dark text-white"><ym-icon name="play" [size]="18" /></span>
          <div>
            <h1 class="text-lg font-bold">YoutubeMeta</h1>
            <p class="text-xs muted">Sube tus videos y publícalos en todas tus redes a la vez</p>
          </div>
        </div>

        <label class="label" for="user">Usuario <ym-req /></label>
        <input id="user" name="user" class="input mb-4" autocomplete="username" [(ngModel)]="userName" required />

        <label class="label" for="password">Contraseña <ym-req /></label>
        <input id="password" name="password" type="password" class="input mb-4" autocomplete="current-password" [(ngModel)]="password" required />

        @if (error()) {
          <div class="notice notice-error mb-4" role="alert">{{ error() }}</div>
        }

        <button type="submit" class="btn btn-primary w-full py-2" [disabled]="loading() || !userName() || !password()">
          {{ loading() ? 'Ingresando…' : 'Ingresar' }}
        </button>
      </form>
    </div>
  `
})
export class LoginPage {
  private readonly auth = inject(AuthHttp);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly userName = signal('');
  protected readonly password = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      this.session.start(await firstValueFrom(this.auth.login(this.userName().trim(), this.password())));
      await this.router.navigate(['/library']);
    } catch (error) {
      this.error.set(apiError(error, 'No se pudo iniciar sesión.'));
    } finally {
      this.loading.set(false);
    }
  }
}
