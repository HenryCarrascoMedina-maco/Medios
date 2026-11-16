import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ConnectionHttp, TemplateHttp } from '../http/api.http';
import { IPlaylist, ITemplate, ITextBlock } from '../models/api.models';

/**
 * Plantillas propias (de publicación y respuestas de la bandeja), bloques de hashtags y listas de YouTube compartidos
 * entre Ajustes, el diálogo de publicación y la bandeja. Se piden una vez y se recargan tras guardar. Las listas se
 * cachean por canal.
 */
@Injectable({ providedIn: 'root' })
export class TemplateStoreService {
  private readonly http = inject(TemplateHttp);
  private readonly connections = inject(ConnectionHttp);
  private readonly playlistCache = new Map<number, Promise<IPlaylist[]>>();
  private loaded: Promise<void> | null = null;

  readonly templates = signal<ITemplate[]>([]);
  readonly blocks = signal<ITextBlock[]>([]);
  /** Plantillas del diálogo de publicación. */
  readonly publishTemplates = computed(() => this.templates().filter(t => t.usage === 'PUBLISH'));
  /** Respuestas de la bandeja (/atajo), por atajo. */
  readonly replies = computed(() => this.templates().filter(t => t.usage === 'REPLY').sort((a, b) => (a.shortcut ?? '').localeCompare(b.shortcut ?? '')));
  readonly defaultTemplate = computed(() => this.publishTemplates().find(t => t.isDefault) ?? null);
  readonly blockNames = computed(() => this.blocks().map(b => b.name));
  /** nombre → contenido, para resolver #bloque:nombre. */
  readonly blockMap = computed<Record<string, string>>(() => Object.fromEntries(this.blocks().map(b => [b.name, b.content])));

  /** Carga (una vez) plantillas y bloques. Un fallo no bloquea: el diálogo y la bandeja funcionan sin ellos. */
  ensure(): Promise<void> {
    this.loaded ??= this.reload().catch(() => {
      this.loaded = null;
    });
    return this.loaded;
  }

  async reload(): Promise<void> {
    const [templates, blocks] = await Promise.all([firstValueFrom(this.http.list()), firstValueFrom(this.http.blocks())]);
    this.templates.set(templates);
    this.blocks.set(blocks);
    this.loaded ??= Promise.resolve();
  }

  /** Aviso para el diálogo de borrar medios: qué plantillas los usan (vacío si ninguna). */
  async mediaUsageNote(mediaIds: readonly number[]): Promise<string> {
    await this.ensure();
    const ids = new Set(mediaIds);
    const using = this.templates().filter(t => t.media.some(m => ids.has(m.mediaId)));
    if (!using.length) return '';
    const names = using.slice(0, 3).map(t => `«${t.name}»`).join(', ') + (using.length > 3 ? ` y ${using.length - 3} más` : '');
    return ` ${using.length === 1 ? 'Lo usa la plantilla' : `Lo usan ${using.length} plantillas:`} ${names}; allí quedará marcado como borrado y se omitirá.`;
  }

  /** Cuenta un uso (orden por más usadas). Si falla, no molesta: es solo estadística. */
  markUsed(id: number): void {
    firstValueFrom(this.http.used(id))
      .then(() => this.templates.update(list => list.map(t => (t.id === id ? { ...t, useCount: t.useCount + 1 } : t))))
      .catch(() => undefined);
  }

  playlists(connectionId: number): Promise<IPlaylist[]> {
    let entry = this.playlistCache.get(connectionId);
    if (!entry) {
      entry = firstValueFrom(this.connections.youtubePlaylists(connectionId)).catch(error => {
        this.playlistCache.delete(connectionId);
        throw error;
      });
      this.playlistCache.set(connectionId, entry);
    }
    return entry;
  }
}
