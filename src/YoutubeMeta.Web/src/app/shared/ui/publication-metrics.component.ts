import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IPublication } from '@core/models/api.models';
import { IconComponent } from './icon.component';

/** Vistas, me gusta y comentarios de lo ya publicado, si la plataforma los dio. */
@Component({
  selector: 'ym-publication-metrics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, IconComponent],
  host: { class: 'contents' },
  template: `
    @let p = publication();
    @if (p.views != null || p.likes != null || p.comments != null) {
      <div class="mt-1 flex flex-wrap gap-3 text-[11px] muted" aria-label="Métricas">
        @if (p.views != null) { <span class="inline-flex items-center gap-1" title="Vistas"><ym-icon name="eye" [size]="11" /> {{ p.views | number }}</span> }
        @if (p.likes != null) { <span class="inline-flex items-center gap-1" title="Me gusta"><ym-icon name="heart" [size]="11" /> {{ p.likes | number }}</span> }
        @if (p.comments != null) { <span class="inline-flex items-center gap-1" title="Comentarios"><ym-icon name="message" [size]="11" /> {{ p.comments | number }}</span> }
      </div>
    }
  `
})
export class PublicationMetricsComponent {
  readonly publication = input.required<Pick<IPublication, 'views' | 'likes' | 'comments'>>();
}
