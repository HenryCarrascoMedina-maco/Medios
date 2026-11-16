import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { PosterService } from '@core/services/poster.service';
import { formatDuration, isShort } from '@core/utils/format';
import { IconComponent } from './ui/icon.component';

/** Miniatura del video; sin miniatura, un degradado estable según el id. */
@Component({
  selector: 'ym-poster',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'relative block overflow-hidden bg-black' },
  template: `
    <div class="relative grid aspect-video place-items-center text-white" [style.background]="src() ? null : gradient()">
      @if (src(); as url) {
        <img [src]="url" alt="" class="absolute inset-0 h-full w-full object-contain" loading="lazy" />
      }
      @if (showPlay()) {
        <span class="relative grid h-11 w-11 place-items-center rounded-full bg-black/40 backdrop-blur-sm"><ym-icon name="play" [size]="20" /></span>
      }
      @if (short()) {
        <span class="absolute left-2 top-2 rounded bg-youtube px-1.5 text-[11px] font-bold">SHORT</span>
      }
      @if (durationSec() != null) {
        <span class="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 text-[11px]">{{ duration() }}</span>
      }
    </div>
  `
})
export class PosterComponent {
  private readonly posters = inject(PosterService);

  readonly videoId = input.required<number>();
  readonly hasPoster = input(false);
  readonly durationSec = input<number | null>(null);
  readonly width = input<number | null>(null);
  readonly height = input<number | null>(null);
  readonly showPlay = input(true);

  protected readonly src = signal<string | null>(null);
  protected readonly duration = computed(() => formatDuration(this.durationSec()));
  protected readonly short = computed(() => isShort(this.width(), this.height(), this.durationSec()));
  protected readonly gradient = computed(() => {
    const hue = (this.videoId() * 67) % 360;
    return `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 40) % 360} 60% 25%))`;
  });

  constructor() {
    effect(() => {
      const id = this.videoId();
      this.posters.revision();
      this.src.set(null);
      if (this.hasPoster()) void this.posters.get(id).then(url => this.src.set(url));
    });
  }
}
