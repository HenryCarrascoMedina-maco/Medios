import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PLATFORM_META } from '@core/constants/status.constants';
import { ConnectionHttp, MetaPlatform } from '@core/http/api.http';
import { IAccountSaveResult, IMetaAccountOption, Platform } from '@core/models/api.models';
import { ToastService } from '@core/services/toast.service';
import { apiError } from '@core/utils/format';
import { IconComponent } from '@shared/ui/icon.component';
import { ModalComponent } from '@shared/ui/modal.component';
import { SaveResultsComponent } from '@shared/ui/save-results.component';
import { ReqComponent } from '@shared/ui/req.component';
import { toggled } from '@core/utils/selection';

/** Textos del asistente para cada plataforma de Meta (un solo asistente, sin «if Facebook / Instagram» en la plantilla). */
const WIZARD: Record<MetaPlatform, { platform: Platform; title: string; find: string; choose: string; none: string; single: string; plural: string; tokenHint: string }> = {
  Facebook: {
    platform: 'FACEBOOK', title: 'Conectar Páginas de Facebook', find: 'Buscar Páginas', choose: 'las Páginas', none: 'ninguna Página',
    single: 'Página conectada', plural: 'Páginas conectadas',
    tokenHint: 'Se usa solo para encontrar las Páginas y obtener el token de cada una; no se guarda.'
  },
  Instagram: {
    platform: 'INSTAGRAM', title: 'Conectar cuentas de Instagram', find: 'Buscar cuentas de Instagram', choose: 'las cuentas', none: 'ninguna cuenta',
    single: 'cuenta conectada', plural: 'cuentas conectadas',
    tokenHint: 'Se guarda cifrado: Instagram publica con este token. Debe incluir instagram_basic e instagram_content_publish.'
  },
  WhatsApp: {
    platform: 'WHATSAPP', title: 'Conectar números de WhatsApp Business', find: 'Buscar números', choose: 'los números', none: 'ningún número',
    single: 'número conectado', plural: 'números conectados',
    tokenHint: 'Se guarda cifrado: la bandeja responde con este token. Debe incluir whatsapp_business_messaging y whatsapp_business_management.'
  }
};

/** Asistente de Meta (Facebook, Instagram o WhatsApp): 1) token del usuario del sistema → 2) elegir cuentas. */
@Component({
  selector: 'ym-meta-wizard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ModalComponent, IconComponent, SaveResultsComponent, ReqComponent],
  template: `
    @let w = wizard();
    <ym-modal #modal [title]="w.title" [width]="640" [dirty]="!!token().trim() && !saved()" (closed)="closed.emit()">
      <ym-icon modal-icon [name]="meta().icon" [size]="20" [class]="meta().text" />

      <div>
        <label class="label" for="meta-token">1. Token del usuario del sistema de Meta Business <ym-req /></label>
        <textarea id="meta-token" class="input min-h-20 font-mono text-xs" [value]="token()" (input)="token.set($any($event.target).value)" placeholder="EAAG…" autocomplete="off" spellcheck="false"></textarea>
        <p class="hint">
          {{ w.tokenHint }}
          ¿Aún no lo tienes? <a [routerLink]="['/guides', meta().guide]" (click)="closed.emit()">Guía paso a paso</a> ·
          <a [routerLink]="['/guides', meta().guide]" fragment="faqs" (click)="closed.emit()">Problemas frecuentes</a>
        </p>
        <button type="button" class="btn btn-sm mt-2" [disabled]="token().trim().length < 20 || busy() !== null" (click)="find()">
          <ym-icon name="search" [size]="13" /> {{ busy() === 'find' ? 'Buscando…' : w.find }}
        </button>
      </div>

      @if (options(); as list) {
        <fieldset>
          <legend class="label">2. Elige {{ w.choose }} <ym-req /> <small>puedes marcar varias</small></legend>
          <div class="grid gap-2">
            @for (o of list; track o.id) {
              <label class="choice" [class.opacity-60]="!o.canPublish">
                <input type="checkbox" [checked]="selected().has(o.id)" [disabled]="!o.canPublish" (change)="toggle(o.id)" />
                @if (o.pictureUrl) { <img [src]="o.pictureUrl" alt="" class="h-8 w-8 rounded-full" referrerpolicy="no-referrer" /> }
                <span class="min-w-0 flex-1">
                  <b class="block truncate">{{ o.name }} @if (o.username) { <span class="font-normal muted">&#64;{{ o.username }}</span> }</b>
                  <span class="block text-xs muted">{{ o.detail ?? o.id }}@if (o.alreadyConnected) { · ya conectada (se reconecta) }</span>
                  @if (o.problem) { <span class="block text-xs text-red-500">{{ o.problem }}</span> }
                </span>
              </label>
            } @empty {
              <p class="text-xs muted">El token no da acceso a {{ w.none }}.</p>
            }
          </div>
        </fieldset>
      }

      @if (results(); as list) {
        <ym-save-results [results]="list" />
      }

      <ng-container modal-footer>
        <button type="button" class="btn" (click)="modal.requestClose()">Cerrar</button>
        <button type="button" class="btn" [class]="meta().btn" [disabled]="selected().size === 0 || busy() !== null" (click)="save()">
          {{ busy() === 'save' ? 'Conectando…' : 'Conectar ' + selected().size }}
        </button>
      </ng-container>
    </ym-modal>
  `
})
export class MetaWizardDialog {
  private readonly http = inject(ConnectionHttp);
  private readonly toast = inject(ToastService);

  readonly platform = input.required<MetaPlatform>();
  readonly closed = output<void>();
  /** Alguna cuenta se conectó: la página recarga. */
  readonly connected = output<void>();

  protected readonly token = signal('');
  protected readonly options = signal<IMetaAccountOption[] | null>(null);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly results = signal<IAccountSaveResult[] | null>(null);
  protected readonly busy = signal<'find' | 'save' | null>(null);
  protected readonly saved = signal(false);
  protected readonly wizard = computed(() => WIZARD[this.platform()]);
  protected readonly meta = computed(() => PLATFORM_META[this.wizard().platform]);

  protected async find(): Promise<void> {
    this.busy.set('find');
    try {
      const options = await firstValueFrom(this.http.metaAccounts(this.platform(), this.token().trim()));
      this.options.set(options);
      this.selected.set(new Set(options.filter(o => o.canPublish && !o.alreadyConnected).map(o => o.id)));
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudo leer a qué da acceso el token.'));
    } finally {
      this.busy.set(null);
    }
  }

  protected toggle(id: string): void {
    this.selected.set(toggled(this.selected(), id));
  }

  protected async save(): Promise<void> {
    if (this.selected().size === 0) return;
    const platform = this.platform();
    this.busy.set('save');
    try {
      const results = await firstValueFrom(this.http.metaSave(platform, this.token().trim(), [...this.selected()]));
      const ok = results.filter(r => !r.error).length;
      this.toast.success(`${ok} ${ok === 1 ? this.wizard().single : this.wizard().plural}.`);
      this.saved.set(true);
      this.connected.emit();
      if (results.some(r => r.error)) this.results.set(results);
      else this.closed.emit();
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudieron conectar las cuentas.'));
    } finally {
      this.busy.set(null);
    }
  }
}
