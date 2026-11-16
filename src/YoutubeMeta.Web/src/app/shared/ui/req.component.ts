import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Asterisco de campo obligatorio. Va dentro de la etiqueta, justo después del texto:
 * <label class="label">Título <ym-req /> <small>…</small></label>
 * Si solo es obligatorio en un caso, se pone con @if y la misma condición que usa la validación.
 */
@Component({
  selector: 'ym-req',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'req' },
  template: `<span aria-hidden="true">*</span><span class="sr-only"> (obligatorio)</span>`
})
export class ReqComponent {}
