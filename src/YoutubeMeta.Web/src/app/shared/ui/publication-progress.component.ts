import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PLATFORM_META } from '@core/constants/status.constants';
import { IPublication } from '@core/models/api.models';
import { formatBytes } from '@core/utils/format';
import { ProgressBarComponent } from './progress-bar.component';

type ProgressSource = Pick<IPublication, 'statusCode' | 'percent' | 'target'> & Partial<Pick<IPublication, 'bytesSent' | 'totalBytes'>>;

/**
 * Avance de una publicación hacia su plataforma: barra con porcentaje al subir, rayas al procesar.
 * `detailed` añade bytes enviados y la explicación del procesado (detalle del video).
 */
@Component({
  selector: 'ym-publication-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProgressBarComponent],
  host: { class: 'block' },
  template: `
    @let p = publication();
    @switch (p.statusCode) {
      @case ('UPLOADING') {
        <ym-progress [value]="p.percent ?? 0" [platform]="p.target" [ariaLabel]="'Subida a ' + label()" [class.my-2]="detailed()" />
        <span class="text-[11px] muted" [class.text-xs]="detailed()">{{ p.percent ?? 0 }}%@if (detailed() && p.totalBytes) { · {{ bytes() }} }</span>
      }
      @case ('PROCESSING') {
        <ym-progress [processing]="true" [ariaLabel]="'Procesando en ' + label()" [class.my-2]="detailed()" />
        <span class="text-[11px] muted" [class.text-xs]="detailed()">
          @if (detailed()) { Procesando en {{ label() }}… (la plataforma no da un porcentaje fiable) } @else { procesando }
        </span>
      }
      @default { @if (!detailed()) { <span class="muted">—</span> } }
    }
  `
})
export class PublicationProgressComponent {
  readonly publication = input.required<ProgressSource>();
  readonly detailed = input(false);

  protected readonly label = computed(() => PLATFORM_META[this.publication().target].label);
  protected readonly bytes = computed(() => {
    const p = this.publication();
    return `${formatBytes(p.bytesSent)} de ${formatBytes(p.totalBytes)}`;
  });
}
