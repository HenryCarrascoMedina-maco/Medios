import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Barra fija de acciones en lote: «N sel.», los botones (contenido) y «Quitar selección».
 * La usan Biblioteca y Publicaciones.
 */
@Component({
  selector: 'ym-bulk-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sticky top-16 z-20 mb-3 block' },
  template: `
    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-brand/40 bg-brand-soft px-3 py-2 text-sm shadow-sm dark:bg-surface"
         role="region" aria-label="Acciones en lote">
      <b aria-live="polite">{{ count() }} sel.</b>
      <ng-content />
      <div class="flex-1"></div>
      <button type="button" class="btn btn-ghost btn-sm" (click)="cleared.emit()">Quitar selección</button>
    </div>
  `
})
export class BulkBarComponent {
  readonly count = input.required<number>();
  readonly cleared = output<void>();
}
