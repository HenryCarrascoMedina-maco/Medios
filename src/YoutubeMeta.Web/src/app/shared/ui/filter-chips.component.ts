import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface IFilterOption<T> {
  value: T;
  label: string;
  count?: number | null;
}

/**
 * Pastillas de filtro de una sola opción (aria-pressed). Desplazable en móvil.
 * <ym-filter-chips ariaLabel="Estado" [options]="…" [(value)]="estado" />
 */
@Component({
  selector: 'ym-filter-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <div class="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" [attr.aria-label]="ariaLabel()">
      @for (o of options(); track $index) {
        @let on = o.value === value();
        <button type="button" class="shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition" [attr.aria-pressed]="on"
                [class]="on ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900' : 'border-line bg-surface hover:border-line-strong'"
                (click)="value.set(o.value)">
          {{ o.label }}@if (o.count != null) { <span class="ml-1 opacity-60">{{ o.count }}</span> }
        </button>
      }
    </div>
  `
})
export class FilterChipsComponent<T> {
  readonly options = input.required<readonly IFilterOption<T>[]>();
  readonly value = model.required<T>();
  readonly ariaLabel = input('Filtro');
}
