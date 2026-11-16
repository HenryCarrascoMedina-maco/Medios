import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from './icon.component';
import { IconName } from './icons';

/** Cifra destacada con su etiqueta (Resultados). */
@Component({
  selector: 'ym-kpi-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'card block p-3' },
  template: `
    <div class="flex items-center gap-1.5 text-xs muted">@if (icon(); as i) { <ym-icon [name]="i" [size]="13" /> }{{ label() }}</div>
    <div class="mt-1 text-2xl font-bold tabular-nums" [class]="tone()">{{ value() }}</div>
    @if (hint()) { <div class="text-[11px] muted">{{ hint() }}</div> }
  `
})
export class KpiTileComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string | number | null>();
  readonly hint = input<string | null>(null);
  readonly icon = input<IconName | null>(null);
  /** Clase de color del valor (p. ej. text-red-600). */
  readonly tone = input('');
}
