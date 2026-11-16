import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IVideo, PostKind } from '@core/models/api.models';
import { linkHost } from '@core/utils/post-kind';
import { IconComponent } from '@shared/ui/icon.component';
import { MediaThumbComponent } from '@shared/ui/media-thumb.component';

/**
 * Lo visual de una publicación en las vistas previas: cuadrícula de imágenes (con «+N»), el video,
 * la ficha del PDF o la tarjeta del enlace. Sin medios ni enlace no pinta nada.
 */
@Component({
  selector: 'ym-post-media',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, MediaThumbComponent],
  host: { class: 'block' },
  template: `
    @switch (kind()) {
      @case ('LINK') {
        <div class="m-2 overflow-hidden rounded-md border border-line bg-field">
          <div class="grid aspect-[2/1] place-items-center bg-surface-muted muted"><ym-icon name="link" [size]="22" /></div>
          <div class="p-2">
            <b class="block truncate text-[12px]">{{ host() }}</b>
            <span class="block truncate text-[10px] muted">{{ linkUrl() }}</span>
          </div>
        </div>
      }
      @case ('TEXT') {}
      @default {
        @if (shown().length === 1) {
          <ym-media-thumb [media]="shown()[0]" [showPlay]="kind() === 'VIDEO'" />
        } @else {
          <div class="grid gap-0.5" [class]="shown().length === 3 ? 'grid-cols-2 [&>*:first-child]:col-span-2' : 'grid-cols-2'">
            @for (m of shown(); track m.id; let last = $last) {
              <div class="relative">
                <ym-media-thumb [media]="m" [compact]="true" />
                @if (last && hidden() > 0) {
                  <span class="absolute inset-0 grid place-items-center bg-black/55 text-lg font-bold text-white">+{{ hidden() }}</span>
                }
              </div>
            }
          </div>
        }
      }
    }
  `
})
export class PostMediaComponent {
  readonly media = input<readonly IVideo[]>([]);
  readonly kind = input.required<PostKind>();
  readonly linkUrl = input('');
  /** Cuántos se ven como mucho (el resto va en «+N»). */
  readonly max = input(4);

  protected readonly shown = computed(() => this.media().slice(0, this.max()));
  protected readonly hidden = computed(() => Math.max(0, this.media().length - this.max()));
  protected readonly host = computed(() => linkHost(this.linkUrl()));
}
