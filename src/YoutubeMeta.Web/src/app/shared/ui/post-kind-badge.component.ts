import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { POST_KIND_META } from '@core/constants/status.constants';
import { PostKind } from '@core/models/api.models';
import { IconComponent } from './icon.component';

/** Tipo de publicación con su icono: «Carrusel · 4», «Enlace», «PDF»… */
@Component({
  selector: 'ym-post-kind-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'inline-flex items-center gap-1 whitespace-nowrap text-xs' },
  template: `
    <ym-icon [name]="meta().icon" [size]="size()" class="muted" [label]="showLabel() ? null : text()" />
    @if (showLabel()) { <span>{{ text() }}</span> }
  `
})
export class PostKindBadgeComponent {
  /** Sin tipo (respuestas antiguas) = video. */
  readonly kind = input<PostKind | null | undefined>('VIDEO');
  /** Número de medios: se añade en los carruseles. */
  readonly count = input<number | null | undefined>(null);
  readonly showLabel = input(true);
  readonly size = input(13);

  protected readonly meta = computed(() => POST_KIND_META[this.kind() ?? 'VIDEO']);
  protected readonly text = computed(() => {
    const count = this.count();
    return this.kind() === 'CAROUSEL' && count ? `${this.meta().label} · ${count}` : this.meta().label;
  });
}
