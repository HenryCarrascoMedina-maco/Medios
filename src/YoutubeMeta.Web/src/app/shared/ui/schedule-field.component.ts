import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { ClockService } from '@core/services/clock.service';
import { toLocalInput } from '@core/utils/format';
import { ReqComponent } from './req.component';

let nextId = 0;

/**
 * Campo «Programar» (fecha y hora local). La fecha mínima avanza sola con el reloj compartido.
 * El texto de ayuda extra va como contenido: <ym-schedule-field …><p class="hint">…</p></ym-schedule-field>
 */
@Component({
  selector: 'ym-schedule-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReqComponent],
  host: { class: 'block' },
  template: `
    <label class="label" [for]="inputId()">{{ label() }} @if (required()) { <ym-req /> } @if (hint()) { <small>{{ hint() }}</small> }</label>
    <div class="flex gap-2">
      <input [id]="inputId()" type="datetime-local" class="input" [min]="min()" [value]="value()" (input)="onInput($event)" />
      @if (value()) {
        <button type="button" class="btn btn-ghost btn-sm shrink-0" (click)="value.set('')">Quitar</button>
      }
    </div>
    <ng-content />
  `
})
export class ScheduleFieldComponent {
  private readonly clock = inject(ClockService);

  /** Valor de <input type="datetime-local"> («2026-11-15T10:30»); vacío = sin programar. */
  readonly value = model('');
  readonly label = input('Programar');
  readonly hint = input('opcional');
  /** Pinta el asterisco de obligatorio (la validación sigue en quien lo usa). */
  readonly required = input(false);
  /** Antelación mínima respecto de ahora (Facebook exige 10 minutos). */
  readonly minLeadMs = input(60_000);
  readonly inputId = input(`ym-schedule-${++nextId}`);

  protected readonly min = computed(() => toLocalInput(new Date(this.clock.now() + this.minLeadMs())));

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
