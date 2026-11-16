import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { InboxHttp } from '@core/http/api.http';
import { IWhatsAppTemplate } from '@core/models/api.models';

/** Plantilla elegida y sus valores; `complete` = están todas las variables. */
export interface ITemplateChoice {
  name: string;
  language: string;
  params: string[];
  complete: boolean;
}

/**
 * Plantillas aprobadas de un número de WhatsApp: elegir una, rellenar {{1}}, {{2}}… y ver cómo queda. La usan el
 * compositor (ventana cerrada) y «Nueva conversación» (empezar por número).
 */
@Component({
  selector: 'ym-template-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  host: { class: 'grid gap-2' },
  template: `
    @if (templates() === null) {
      <p class="text-xs muted">Cargando plantillas aprobadas…</p>
    } @else if (!templates()!.length) {
      <p class="text-xs muted">No hay plantillas aprobadas. Créalas en el Administrador de WhatsApp (<a routerLink="/guides/whatsapp" [queryParams]="{ step: 'probar' }">cómo</a>).</p>
    } @else {
      <label class="label" [for]="selectId">Plantilla <small>Meta la cobra según el país</small></label>
      <select [id]="selectId" class="input" [ngModel]="selected()" (ngModelChange)="pick($event)">
        <option value="">Elige una plantilla…</option>
        @for (t of templates(); track t.name + t.language) { <option [value]="t.name + '|' + t.language">{{ t.name }} · {{ t.language }} · {{ t.category }}</option> }
      </select>
      @if (template()) {
        @for (p of params(); track $index) {
          <input class="input" [placeholder]="'Valor de {{' + ($index + 1) + '}}'" [ngModel]="p" (ngModelChange)="setParam($index, $event)" [attr.aria-label]="'Variable ' + ($index + 1)" />
        }
        <div class="rounded-lg border border-line bg-field p-2 text-sm whitespace-pre-wrap">{{ preview() }}</div>
      }
    }
  `
})
export class TemplatePickerComponent {
  private readonly http = inject(InboxHttp);
  private static nextId = 0;

  /** Número de WhatsApp (cuenta) del que salen las plantillas. */
  readonly connectionId = input.required<number>();
  readonly choice = output<ITemplateChoice | null>();

  protected readonly selectId = `ym-template-${++TemplatePickerComponent.nextId}`;
  protected readonly templates = signal<IWhatsAppTemplate[] | null>(null);
  protected readonly selected = signal('');
  protected readonly params = signal<string[]>([]);

  protected readonly template = computed(() => this.templates()?.find(t => `${t.name}|${t.language}` === this.selected()) ?? null);
  protected readonly preview = computed(() =>
    (this.template()?.body ?? '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => this.params()[Number(n) - 1] || `{{${n}}}`));

  constructor() {
    effect(() => {
      const connectionId = this.connectionId();
      untracked(() => {
        this.templates.set(null);
        this.reset();
        void this.load(connectionId);
      });
    });
  }

  /** Vuelve a «Elige una plantilla…» (después de enviar). */
  reset(): void {
    this.selected.set('');
    this.params.set([]);
    this.choice.emit(null);
  }

  protected pick(value: string): void {
    this.selected.set(value);
    this.params.set(Array.from({ length: this.template()?.paramCount ?? 0 }, () => ''));
    this.emit();
  }

  protected setParam(index: number, value: string): void {
    this.params.update(list => list.map((p, i) => (i === index ? value : p)));
    this.emit();
  }

  private emit(): void {
    const t = this.template();
    this.choice.emit(t ? { name: t.name, language: t.language, params: this.params().map(p => p.trim()), complete: this.params().every(p => p.trim().length > 0) } : null);
  }

  private async load(connectionId: number): Promise<void> {
    try {
      const list = await firstValueFrom(this.http.templates(connectionId));
      if (this.connectionId() === connectionId) this.templates.set(list);
    } catch {
      if (this.connectionId() === connectionId) this.templates.set([]);
    }
  }
}
