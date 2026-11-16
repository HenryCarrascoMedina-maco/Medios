import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SessionKeeperService } from '@core/session/session-keeper.service';
import { SessionService } from '@core/session/session.service';
import { ToastService } from '@core/services/toast.service';
import { VideoUploadService, uploadPercent } from '@core/services/video-upload.service';
import { apiError, formatCountdown } from '@core/utils/format';
import { IconComponent } from '@shared/ui/icon.component';
import { ModalComponent } from '@shared/ui/modal.component';
import { ReqComponent } from '@shared/ui/req.component';

/**
 * Aviso de caducidad (5 minutos antes) con «Seguir conectado», y el mismo diálogo en modo
 * «escribe tu contraseña» cuando el token ya caducó o el servidor respondió 401. No destruye el
 * shell: la pantalla y las subidas (pausadas) siguen ahí al volver a entrar.
 */
@Component({
  selector: 'ym-session-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ModalComponent, IconComponent, ReqComponent],
  template: `
    @if (mode(); as m) {
      <ym-modal [title]="m === 'reauth' ? 'Tu sesión caducó' : 'Tu sesión caduca en ' + countdown()" [width]="440"
                [closable]="m === 'warning'" (closed)="dismiss()">
        <ym-icon modal-icon name="hourglass" [size]="20" class="text-brand" />

        @if (uploadSummary(); as summary) {
          <p class="text-sm">
            {{ summary }}
            @if (m === 'reauth') { Están en pausa y continúan solas al volver a entrar. }
            @else { Si la sesión termina se pausan y podrás reanudarlas al volver a entrar. }
          </p>
        } @else if (m === 'warning') {
          <p class="text-sm">Pulsa «Seguir conectado» para renovarla sin perder lo que estás haciendo.</p>
        }

        @if (m === 'reauth') {
          <form id="reauth-form" class="grid gap-2" (ngSubmit)="reauthenticate()">
            <p class="text-sm muted">Escribe la contraseña de <b>{{ session.user()?.userName }}</b> para seguir donde estabas.</p>
            <label class="label !mb-0" for="reauth-password">Contraseña <ym-req /></label>
            <input id="reauth-password" name="password" type="password" class="input" autocomplete="current-password" autofocus
                   [ngModel]="password()" (ngModelChange)="password.set($event)" required />
          </form>
        }
        @if (error()) { <div class="notice notice-error" role="alert">{{ error() }}</div> }

        <ng-container modal-footer>
          <button type="button" class="btn" (click)="logout()"><ym-icon name="logout" [size]="14" /> Salir</button>
          @if (m === 'reauth') {
            <button type="submit" form="reauth-form" class="btn btn-primary" [disabled]="busy() || !password()">{{ busy() ? 'Entrando…' : 'Entrar' }}</button>
          } @else {
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="refresh()">{{ busy() ? 'Renovando…' : 'Seguir conectado' }}</button>
          }
        </ng-container>
      </ym-modal>
    }
  `
})
export class SessionDialogComponent {
  protected readonly session = inject(SessionService);
  private readonly keeper = inject(SessionKeeperService);
  private readonly uploads = inject(VideoUploadService);
  private readonly toast = inject(ToastService);

  /** expiresAt cuyo aviso se cerró: no se vuelve a mostrar hasta que caduque o se renueve. */
  private readonly dismissedFor = signal(0);
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly mode = computed<'warning' | 'reauth' | null>(() => {
    if (this.session.reauthRequired()) return 'reauth';
    if (this.session.expiringSoon() && this.dismissedFor() !== this.session.expiresAt()) return 'warning';
    return null;
  });
  protected readonly countdown = computed(() => formatCountdown(this.session.remainingMs()));

  /** «Hay 2 subidas en curso (63 % y 12 %).» */
  protected readonly uploadSummary = computed(() => {
    const active = this.uploads.active();
    if (active.length === 0) return null;
    const percents = active.map(u => `${uploadPercent(u)} %`);
    const list = percents.length > 1 ? `${percents.slice(0, -1).join(', ')} y ${percents[percents.length - 1]}` : percents[0];
    return active.length === 1 ? `Hay 1 subida en curso (${list}).` : `Hay ${active.length} subidas en curso (${list}).`;
  });

  protected dismiss(): void {
    this.dismissedFor.set(this.session.expiresAt());
  }

  protected async refresh(): Promise<void> {
    await this.run(() => this.keeper.refresh(), 'No se pudo renovar la sesión.');
    // Si el servidor ya no acepta el token (401), el diálogo pasa solo a pedir la contraseña.
    if (this.session.reauthRequired()) this.error.set(null);
    else if (!this.error()) this.toast.success('Sesión renovada.');
  }

  protected async reauthenticate(): Promise<void> {
    if (!this.password() || this.busy()) return;
    await this.run(() => this.keeper.reauthenticate(this.password()), 'Contraseña incorrecta.');
    if (!this.error()) this.password.set('');
  }

  protected logout(): void {
    this.error.set(null);
    this.password.set('');
    this.session.logout();
  }

  private async run(action: () => Promise<void>, fallback: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(apiError(error, fallback));
    } finally {
      this.busy.set(false);
    }
  }
}
