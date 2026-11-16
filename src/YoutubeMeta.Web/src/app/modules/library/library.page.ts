import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, filter, firstValueFrom, merge, skip } from 'rxjs';
import { PLATFORM_META } from '@core/constants/status.constants';
import { RulesService } from '@core/services/rules.service';
import { VideoHttp } from '@core/http/api.http';
import { IVideo, LibrarySort, LibraryStatus, MediaKind, Platform } from '@core/models/api.models';
import { ConfirmService } from '@core/services/confirm.service';
import { TemplateStoreService } from '@core/services/template-store.service';
import { EntityHubService } from '@core/services/entity-hub.service';
import { PosterService } from '@core/services/poster.service';
import { TagStoreService } from '@core/services/tag-store.service';
import { ToastService } from '@core/services/toast.service';
import { IUploadItem, VideoUploadService, uploadPercent } from '@core/services/video-upload.service';
import { apiError, formatBytes } from '@core/utils/format';
import { createPagedLoader } from '@core/utils/paged-loader';
import { selectRange } from '@core/utils/selection';
import { readStored, writeStored } from '@core/utils/storage';
import { IPublishSchedule, PublishDialog } from '@shared/publish/publish.dialog';
import { MEDIA_KIND_OPTIONS } from '@shared/publish/media-picker.dialog';
import { createPublishLauncher } from '@shared/publish/publish-launcher';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { BulkBarComponent } from '@shared/ui/bulk-bar.component';
import { FilterChipsComponent, IFilterOption } from '@shared/ui/filter-chips.component';
import { IconComponent } from '@shared/ui/icon.component';
import { InfiniteScrollDirective } from '@shared/ui/infinite-scroll.directive';
import { ProgressBarComponent } from '@shared/ui/progress-bar.component';
import { SeriesDialogComponent } from './series-dialog.component';
import { TagDialogComponent } from './tag-dialog.component';
import { LibraryLayout, VideoCardComponent } from './video-card.component';

const LAYOUT_KEY = 'ym.library.layout';
/** Lo que admite la subida (el servidor tiene la última palabra con allowedExtensions). */
const UPLOAD_ACCEPT = 'video/*,.mkv,.avi,image/jpeg,image/png,.jpg,.jpeg,.png,application/pdf,.pdf';
const PAGE_SIZE = 48;

const STATUS_OPTIONS: IFilterOption<LibraryStatus | ''>[] = [
  { value: '', label: 'Todos' },
  { value: 'UNPUBLISHED', label: 'Sin publicar' },
  { value: 'ACTIVE', label: 'En curso' },
  { value: 'SCHEDULED', label: 'Programados' },
  { value: 'PUBLISHED', label: 'Publicados' },
  { value: 'ERROR', label: 'Con error' }
];

const SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: 'NEWEST', label: 'Más recientes' },
  { value: 'OLDEST', label: 'Más antiguos' },
  { value: 'TITLE', label: 'Título (A-Z)' },
  { value: 'SIZE', label: 'Tamaño' },
  { value: 'DURATION', label: 'Duración' }
];

type BulkDialog = 'tags' | 'series' | null;

@Component({
  selector: 'ym-library-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncStateComponent, BulkBarComponent, FilterChipsComponent, IconComponent, InfiniteScrollDirective, ProgressBarComponent,
    VideoCardComponent, PublishDialog, TagDialogComponent, SeriesDialogComponent
  ],
  templateUrl: './library.page.html'
})
export class LibraryPage implements OnInit {
  private readonly videosHttp = inject(VideoHttp);
  private readonly rules = inject(RulesService);
  private readonly hub = inject(EntityHubService);
  private readonly confirm = inject(ConfirmService);
  private readonly templates = inject(TemplateStoreService);
  private readonly toast = inject(ToastService);
  private readonly posters = inject(PosterService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly tagStore = inject(TagStoreService);
  protected readonly uploader = inject(VideoUploadService);
  protected readonly publish = createPublishLauncher();

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly kindOptions = MEDIA_KIND_OPTIONS;
  protected readonly accept = UPLOAD_ACCEPT;
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly platformOptions = computed<IFilterOption<Platform | ''>[]>(() =>
    [{ value: '', label: 'Todas' }, ...this.rules.publishPlatforms().map(p => ({ value: p, label: PLATFORM_META[p].label }))]);
  protected readonly tagOptions = computed<IFilterOption<string>[]>(() =>
    [{ value: '', label: 'Todas' }, ...this.tagStore.tags().map(t => ({ value: t.tag, label: `#${t.tag}`, count: t.videoCount }))]);

  protected readonly search = signal('');
  private readonly search$ = toObservable(this.search);
  protected readonly status = signal<LibraryStatus | ''>('');
  protected readonly kind = signal<MediaKind | ''>('');
  protected readonly platform = signal<Platform | ''>('');
  protected readonly tag = signal('');
  protected readonly sort = signal<LibrarySort>('NEWEST');
  protected readonly layout = signal<LibraryLayout>(readStored<LibraryLayout>(LAYOUT_KEY, 'grid'));
  protected readonly dragging = signal(false);

  protected readonly selecting = signal(false);
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  private anchor: number | null = null;
  protected readonly bulkDialog = signal<BulkDialog>(null);
  protected readonly busy = signal(false);

  protected readonly videos = createPagedLoader(
    (offset, take) => this.videosHttp.page({
      searchTerm: this.search().trim() || undefined,
      status: this.status(),
      platform: this.platform(),
      tag: this.tag() || undefined,
      kind: this.kind(),
      sort: this.sort(),
      offset,
      take
    }),
    { take: PAGE_SIZE, errorMessage: 'No se pudo cargar la biblioteca.' }
  );
  protected readonly list = computed(() => this.videos.value() ?? []);
  protected readonly selectedVideos = computed(() => this.list().filter(v => this.selected().has(v.id)));
  /** Marcados en el orden en que se marcaron: es el orden de los medios de la publicación. */
  protected readonly selectedInOrder = computed(() => {
    const byId = new Map(this.list().map(v => [v.id, v]));
    return [...this.selected()].map(id => byId.get(id)).filter((v): v is IVideo => !!v);
  });
  protected readonly filtered = computed(() => !!(this.search().trim() || this.status() || this.platform() || this.tag() || this.kind()));
  protected readonly formatBytes = formatBytes;
  protected readonly percentOf = uploadPercent;

  ngOnInit(): void {
    this.tagStore.refresh();
    this.search$
      .pipe(skip(1), debounceTime(350), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.videos.reset());

    // Algo cambió en el servidor: se recarga desde la primera página (sin vaciar la pantalla).
    merge(this.uploader.completed$, this.hub.on('VideoUpload'), this.hub.publishUpdates().pipe(filter(u => u.isFinal)), this.hub.reconnected$)
      .pipe(debounceTime(600), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refresh());

    // Avance de subida a plataformas: se actualiza la tarjeta sin recargar la lista.
    this.hub.publishUpdates()
      .pipe(filter(u => !u.isFinal), takeUntilDestroyed(this.destroyRef))
      .subscribe(u => this.videos.value.update(list => list?.map(v => v.id !== u.videoId ? v : {
        ...v,
        publications: v.publications.map(p => p.publicationId === u.publicationId ? { ...p, statusCode: u.status, percent: u.percent } : p)
      })));

    this.videos.reload();
  }

  protected setFilter<T>(target: { set(value: T): void }, value: T): void {
    target.set(value);
    this.videos.reset();
  }

  protected setLayout(layout: LibraryLayout): void {
    this.layout.set(layout);
    writeStored(LAYOUT_KEY, layout);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.status.set('');
    this.platform.set('');
    this.tag.set('');
    this.kind.set('');
    this.videos.reset();
  }

  // ── Selección ───────────────────────────────────────────────────────────
  protected toggleSelecting(): void {
    this.selecting.update(on => !on);
    if (!this.selecting()) this.clearSelection();
  }

  protected toggle(video: IVideo, shift: boolean): void {
    this.selecting.set(true);
    this.selected.set(selectRange(this.list().map(v => v.id), this.selected(), this.anchor, video.id, shift));
    this.anchor = video.id;
  }

  protected selectAllLoaded(): void {
    this.selected.set(new Set(this.list().map(v => v.id)));
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
    this.anchor = null;
  }

  // ── Acciones en lote ────────────────────────────────────────────────────
  protected publishSelected(schedule: IPublishSchedule | null = null): void {
    this.bulkDialog.set(null);
    void this.publish.open(this.selectedVideos(), schedule);
  }

  /** Una sola publicación con los medios marcados (en el orden en que se marcaron). */
  protected createPost(): void {
    void this.publish.open(this.selectedInOrder(), null, { asPost: true });
  }

  /** Publicación sin medios (texto o enlace); los medios se pueden añadir en el diálogo. */
  protected newPost(): void {
    void this.publish.open([], null, { asPost: true });
  }

  protected onPublished(): void {
    this.publish.close();
    this.clearSelection();
    this.refresh();
  }

  protected onTagsApplied(): void {
    this.bulkDialog.set(null);
    this.refresh();
  }

  protected async deleteSelected(): Promise<void> {
    const list = this.selectedVideos();
    const accepted = await this.confirm.ask({
      title: `Eliminar ${list.length} ${list.length === 1 ? 'medio' : 'medios'}`,
      message: 'Se borrarán del almacenamiento. Lo ya publicado en las plataformas no se toca.' + (await this.templates.mediaUsageNote(list.map(v => v.id))),
      confirmText: 'Eliminar',
      danger: true
    });
    if (!accepted) return;
    this.busy.set(true);
    try {
      const result = await firstValueFrom(this.videosHttp.deleteMany(list.map(v => v.id)));
      for (const v of list) this.posters.forget(v.id);
      if (result.errors.length) this.toast.warning(`Eliminados ${result.done} de ${list.length}. ${result.errors.slice(0, 2).join(' · ')}`);
      else this.toast.success(`${result.done} ${result.done === 1 ? 'medio eliminado' : 'medios eliminados'}.`);
      this.clearSelection();
      this.refresh();
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudieron eliminar.'));
    } finally {
      this.busy.set(false);
    }
  }

  // ── Subidas ─────────────────────────────────────────────────────────────
  protected onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) this.uploader.add(Array.from(input.files));
    input.value = '';
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) this.uploader.add(files);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected speedOf(item: IUploadItem): string {
    return item.bytesPerSecond ? `${formatBytes(item.bytesPerSecond)}/s` : '';
  }

  private refresh(): void {
    this.videos.reload();
    this.tagStore.refresh();
  }
}
