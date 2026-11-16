import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { VideoHttp } from '../http/api.http';

/**
 * Las miniaturas requieren el token, así que no pueden ir en un <img src> directo: se descargan
 * como blob una sola vez y se reutiliza la object URL (como storeImage en Multimedia de Sinsatools).
 */
@Injectable({ providedIn: 'root' })
export class PosterService {
  private readonly videos = inject(VideoHttp);
  private readonly cache = new Map<number, Promise<string | null>>();
  private readonly versions = new Map<number, number>();
  /** Sube cada vez que cambia una miniatura: los <ym-poster> la vuelven a pedir. */
  readonly revision = signal(0);

  get(videoId: number): Promise<string | null> {
    let entry = this.cache.get(videoId);
    if (!entry) {
      entry = firstValueFrom(this.videos.poster(videoId, this.versions.get(videoId) ?? 0))
        .then(blob => URL.createObjectURL(blob))
        .catch(() => {
          this.cache.delete(videoId);
          return null;
        });
      this.cache.set(videoId, entry);
    }
    return entry;
  }

  /** La miniatura cambió en el servidor: se descarta la guardada y se pide de nuevo (sin caché). */
  refresh(videoId: number): void {
    this.forget(videoId);
    this.versions.set(videoId, Date.now());
    this.revision.update(n => n + 1);
  }

  forget(videoId: number): void {
    const entry = this.cache.get(videoId);
    this.cache.delete(videoId);
    void entry?.then(url => url && URL.revokeObjectURL(url));
  }
}
