import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IAccountSaveResult } from '@core/models/api.models';

/** Resultado de conectar varias cuentas a la vez (Páginas, cuentas de Instagram, canales de Teams): qué entró y qué no, con el motivo. */
@Component({
  selector: 'ym-save-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="notice notice-warn" role="alert">
      @for (r of results(); track r.name) { <div><b>{{ r.name }}</b>: {{ r.error ?? 'conectada' }}</div> }
    </div>
  `
})
export class SaveResultsComponent {
  readonly results = input.required<readonly IAccountSaveResult[]>();
}

