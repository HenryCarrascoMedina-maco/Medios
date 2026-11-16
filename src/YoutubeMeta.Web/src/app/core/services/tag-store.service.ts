import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { VideoHttp } from '../http/api.http';
import { ITagCount } from '../models/api.models';
import { tagDiff } from '../utils/tags';

/** Etiquetas de la biblioteca con su número de videos (filtros y sugerencias) y cambios de etiquetas. */
@Injectable({ providedIn: 'root' })
export class TagStoreService {
  private readonly http = inject(VideoHttp);
  readonly tags = signal<ITagCount[]>([]);

  refresh(): void {
    void firstValueFrom(this.http.tags()).then(tags => this.tags.set(tags)).catch(() => undefined);
  }

  /** Aplica a un video la diferencia entre sus etiquetas y las nuevas. */
  async setTags(videoId: number, before: readonly string[], after: readonly string[]): Promise<void> {
    const { add, remove } = tagDiff(before, after);
    if (!add.length && !remove.length) return;
    await firstValueFrom(this.http.updateTags([videoId], add, remove));
    this.refresh();
  }

  /** Añade y quita etiquetas en varios videos de una vez. */
  async updateMany(videoIds: number[], add: string[], remove: string[]): Promise<number> {
    const changed = await firstValueFrom(this.http.updateTags(videoIds, add, remove));
    this.refresh();
    return changed;
  }
}
