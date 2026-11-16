import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { niceScale } from '@core/utils/chart';

export interface IBarSeries {
  name: string;
  /** Color de relleno SVG (clase de Tailwind: fill-…). */
  fill: string;
}

export interface IBarDatum {
  /** Texto del eje (p. ej. «15/11»). */
  label: string;
  /** Un valor por serie, apilados en ese orden. */
  values: number[];
}

let nextId = 0;
const BAR = 18;
const GAP = 6;
const HEIGHT = 160;
const LEFT = 28;
const BOTTOM = 18;

/**
 * Barras apiladas en SVG propio (sin librería). Accesible: role="img" con título y resumen, y la
 * tabla de datos para lectores de pantalla.
 */
@Component({
  selector: 'ym-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mb-2 flex flex-wrap gap-3 text-xs" aria-hidden="true">
      @for (s of series(); track s.name) {
        <span class="inline-flex items-center gap-1"><svg width="10" height="10"><rect width="10" height="10" rx="2" [attr.class]="s.fill" /></svg>{{ s.name }}</span>
      }
    </div>
    <div class="overflow-x-auto">
      <svg [attr.viewBox]="'0 0 ' + width() + ' ' + (height + bottom)" [attr.width]="width()" [attr.height]="height + bottom" class="max-w-none"
           role="img" [attr.aria-labelledby]="titleId + ' ' + descId">
        <title [attr.id]="titleId">{{ title() }}</title>
        <desc [attr.id]="descId">{{ summary() }}</desc>
        @for (t of scale().ticks; track t) {
          <g>
            <line [attr.x1]="left" [attr.x2]="width()" [attr.y1]="y(t)" [attr.y2]="y(t)" class="stroke-line" stroke-dasharray="2 3" />
            <text [attr.x]="left - 4" [attr.y]="y(t) + 3" text-anchor="end" class="fill-slate-400 text-[9px]">{{ t }}</text>
          </g>
        }
        @for (bar of bars(); track $index) {
          <g>
            @for (seg of bar.segments; track $index) {
              @if (seg.height > 0) {
                <rect [attr.x]="bar.x" [attr.y]="seg.y" [attr.width]="barWidth" [attr.height]="seg.height" rx="2" [attr.class]="seg.fill">
                  <title>{{ bar.label }} · {{ seg.name }}: {{ seg.value }}</title>
                </rect>
              }
            }
            @if (bar.showLabel) {
              <text [attr.x]="bar.x + barWidth / 2" [attr.y]="height + 12" text-anchor="middle" class="fill-slate-400 text-[9px]">{{ bar.label }}</text>
            }
          </g>
        }
      </svg>
    </div>
    <table class="sr-only">
      <caption>{{ title() }}</caption>
      <thead><tr><th>Día</th>@for (s of series(); track s.name) { <th>{{ s.name }}</th> }</tr></thead>
      <tbody>@for (d of data(); track $index) { <tr><td>{{ d.label }}</td>@for (v of d.values; track $index) { <td>{{ v }}</td> }</tr> }</tbody>
    </table>
  `
})
export class BarChartComponent {
  readonly title = input.required<string>();
  readonly series = input.required<readonly IBarSeries[]>();
  readonly data = input.required<readonly IBarDatum[]>();

  protected readonly titleId = `ym-chart-title-${++nextId}`;
  protected readonly descId = `ym-chart-desc-${nextId}`;
  protected readonly height = HEIGHT;
  protected readonly bottom = BOTTOM;
  protected readonly left = LEFT;
  protected readonly barWidth = BAR;

  protected readonly scale = computed(() => niceScale(Math.max(0, ...this.data().map(d => d.values.reduce((a, b) => a + b, 0)))));
  protected readonly width = computed(() => LEFT + this.data().length * (BAR + GAP));
  protected readonly summary = computed(() => {
    const totals = this.series().map((s, i) => `${s.name}: ${this.data().reduce((sum, d) => sum + (d.values[i] ?? 0), 0)}`);
    return `${this.data().length} días. ${totals.join(', ')}.`;
  });

  /** Cada barra con sus tramos apilados de abajo arriba; etiqueta del eje como mucho ~10 veces. */
  protected readonly bars = computed(() => {
    const every = Math.max(1, Math.ceil(this.data().length / 10));
    return this.data().map((d, i) => {
      let base = HEIGHT;
      const segments = d.values.map((value, s) => {
        const h = (value / this.scale().max) * HEIGHT;
        base -= h;
        return { value, height: h, y: base, fill: this.series()[s]?.fill ?? '', name: this.series()[s]?.name ?? '' };
      });
      return { x: LEFT + GAP / 2 + i * (BAR + GAP), label: d.label, segments, showLabel: i % every === 0 || i === this.data().length - 1 };
    });
  });

  protected y(value: number): number {
    return HEIGHT - (value / this.scale().max) * HEIGHT;
  }
}
