import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { VideoHttp } from '@core/http/api.http';
import { captureFrame } from '@core/utils/video-probe';

/**
 * Reproductor con ticket de streaming. El servidor responde por pedazos (206 de 10 MB) y el
 * navegador pide el siguiente a medida que reproduce o salta. Si el ticket vence (410) se pide
 * otro y se continúa en el mismo segundo.
 */
@Component({
  selector: 'ym-video-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="relative grid aspect-video place-items-center overflow-hidden rounded-xl bg-black">
      @if (src(); as url) {
        <video #player [src]="url" controls preload="metadata" playsinline class="h-full w-full" (error)="onError()"></video>
      } @else {
        <span class="text-sm text-slate-400">{{ error() ?? 'Cargando video…' }}</span>
      }
    </div>
  `
})
export class VideoPlayerComponent {
  private readonly videos = inject(VideoHttp);
  private readonly player = viewChild<ElementRef<HTMLVideoElement>>('player');

  readonly videoId = input.required<number>();

  protected readonly src = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  private renewed = false;

  constructor() {
    effect(() => {
      const id = this.videoId();
      this.renewed = false;
      void this.load(id);
    });
  }

  /** Fotograma que se ve ahora, como JPEG (≤ 1280 px, calidad 0,85). null si aún no hay imagen. */
  captureCurrentFrame(): Promise<Blob | null> {
    const element = this.player()?.nativeElement;
    return element ? captureFrame(element, 1280, 0.85) : Promise.resolve(null);
  }

  protected async onError(): Promise<void> {
    if (this.renewed) {
      this.error.set('No se pudo reproducir el video en este navegador (formato no compatible o archivo no disponible).');
      this.src.set(null);
      return;
    }
    this.renewed = true;
    const position = this.player()?.nativeElement.currentTime ?? 0;
    await this.load(this.videoId());
    queueMicrotask(() => {
      const element = this.player()?.nativeElement;
      if (element && position > 0) element.currentTime = position;
    });
  }

  private async load(id: number): Promise<void> {
    try {
      this.src.set(await firstValueFrom(this.videos.streamUrl(id)));
      this.error.set(null);
    } catch {
      this.src.set(null);
      this.error.set('No se pudo abrir el video.');
    }
  }
}
