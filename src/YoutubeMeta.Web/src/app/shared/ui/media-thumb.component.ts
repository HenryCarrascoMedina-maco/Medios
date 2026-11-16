import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MEDIA_KIND_META } from '@core/constants/status.constants';
import { IVideo } from '@core/models/api.models';
import { mediaKindOf } from '@core/utils/post-kind';
import { PosterComponent } from '../poster.component';
import { IconComponent } from './icon.component';

/**
 * Miniatura de un medio de la biblioteca según su tipo: el video con su duración, la imagen (el
 * servidor sirve la propia imagen si no hay miniatura) o una ficha de documento para los PDF.
 */
@Component({
  selector: 'ym-media-thumb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PosterComponent, IconComponent],
  host: { class: 'relative block overflow-hidden' },
  template: `
    @let m = media();
    @switch (kind()) {
      @case ('DOCUMENT') {
        <div class="grid aspect-video place-items-center bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300">
          <span class="grid justify-items-center gap-1">
            <ym-icon name="fileText" [size]="compact() ? 20 : 34" />
            @if (!compact()) { <b class="text-[11px] tracking-wide">PDF</b> }
          </span>
        </div>
      }
      @case ('IMAGE') {
        <ym-poster [videoId]="m.id" [hasPoster]="true" [showPlay]="false" />
      }
      @default {
        <ym-poster [videoId]="m.id" [hasPoster]="m.hasPoster" [durationSec]="compact() ? null : m.durationSec" [width]="m.width" [height]="m.height" [showPlay]="showPlay() && !compact()" />
      }
    }
    @if (showKind()) {
      <span class="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded bg-black/60 text-white" [title]="kindMeta().label">
        <ym-icon [name]="kindMeta().icon" [size]="11" [label]="kindMeta().label" />
      </span>
    }
  `
})
export class MediaThumbComponent {
  readonly media = input.required<IVideo>();
  readonly showPlay = input(true);
  /** Miniatura pequeña (tira de medios, listas): sin duración ni botón de reproducir. */
  readonly compact = input(false);
  /** Icono del tipo en la esquina (útil cuando conviven videos, imágenes y PDF). */
  readonly showKind = input(false);

  protected readonly kind = computed(() => mediaKindOf(this.media()));
  protected readonly kindMeta = computed(() => MEDIA_KIND_META[this.kind()]);
}
