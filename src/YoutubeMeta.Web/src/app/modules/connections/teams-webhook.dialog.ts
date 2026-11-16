import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ConnectionHttp } from '@core/http/api.http';
import { ToastService } from '@core/services/toast.service';
import { apiError } from '@core/utils/format';
import { IconComponent } from '@shared/ui/icon.component';
import { ModalComponent } from '@shared/ui/modal.component';
import { ReqComponent } from '@shared/ui/req.component';

/** URL de un flujo de Workflows: tiene que ser https. */
export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname.includes('.');
  } catch {
    return false;
  }
}

/** «Añadir canal por webhook»: nombre y URL del flujo de Workflows de Teams (forma B de la guía). */
@Component({
  selector: 'ym-teams-webhook',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ModalComponent, IconComponent, ReqComponent],
  template: `
    <ym-modal #modal title="Añadir canal de Teams por webhook" [width]="520" [dirty]="!!url().trim() && !saving()" (closed)="closed.emit()">
      <ym-icon modal-icon name="teams" [size]="20" class="text-teams" />
      <p class="text-sm">Para cuando tu organización no deja registrar apps. En el canal de Teams crea el flujo
        «Publicar en un canal cuando se reciba una solicitud de webhook» y pega aquí la URL.
        <a routerLink="/guides/teams" [queryParams]="{ step: 'webhook-canal' }" (click)="closed.emit()">Cómo hacerlo</a>.</p>
      <div>
        <label class="label" for="wh-name">Nombre <ym-req /> <small>cómo lo verás en YoutubeMeta</small></label>
        <input id="wh-name" class="input" maxlength="100" placeholder="Soporte" [value]="name()" (input)="name.set($any($event.target).value)" />
      </div>
      <div>
        <label class="label" for="wh-url">URL del flujo <ym-req /> <small>empieza por https://</small></label>
        <input id="wh-url" type="password" class="input font-mono text-xs" autocomplete="off" spellcheck="false" placeholder="https://…logic.azure.com/…"
               [value]="url()" (input)="url.set($any($event.target).value)" />
        @if (url().trim() && !validUrl()) { <p class="hint text-red-500">Tiene que ser una dirección https completa.</p> }
      </div>
      <div class="notice notice-warn">Trata esta URL como una contraseña: quien la tenga puede escribir en el canal. Se guarda cifrada.</div>
      <p class="hint">Con webhook solo se publica texto, enlaces e imágenes (por dirección pública); no video ni PDF. El mensaje lo firma «Workflows».</p>
      <ng-container modal-footer>
        <button type="button" class="btn" (click)="modal.requestClose()">Cancelar</button>
        <button type="button" class="btn btn-teams" [disabled]="!canSave()" (click)="save()">{{ saving() ? 'Guardando…' : 'Añadir canal' }}</button>
      </ng-container>
    </ym-modal>
  `
})
export class TeamsWebhookDialog implements OnInit {
  private readonly http = inject(ConnectionHttp);
  private readonly toast = inject(ToastService);

  /** Nombre inicial (al rehacer un canal por webhook). */
  readonly initialName = input('');
  readonly closed = output<void>();
  readonly connected = output<void>();

  protected readonly name = signal('');
  protected readonly url = signal('');
  protected readonly saving = signal(false);
  protected readonly validUrl = computed(() => isHttpsUrl(this.url()));
  protected readonly canSave = computed(() => !!this.name().trim() && this.validUrl() && !this.saving());

  ngOnInit(): void {
    this.name.set(this.initialName());
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;
    this.saving.set(true);
    try {
      await firstValueFrom(this.http.teamsWebhook(this.name().trim(), this.url().trim()));
      this.toast.success(`Canal «${this.name().trim()}» añadido.`);
      this.connected.emit();
      this.closed.emit();
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudo añadir el canal.'));
    } finally {
      this.saving.set(false);
    }
  }
}
