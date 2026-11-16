import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, skip } from 'rxjs';
import { MEDIA_KIND_META } from '@core/constants/status.constants';
import { VideoHttp } from '@core/http/api.http';
import { IVideo, MediaKind } from '@core/models/api.models';
import { createPagedLoader } from '@core/utils/paged-loader';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { FilterChipsComponent, IFilterOption } from '@shared/ui/filter-chips.component';
import { IconComponent } from '@shared/ui/icon.component';
import { MediaThumbComponent } from '@shared/ui/media-thumb.component';
import { ModalComponent } from '@shared/ui/modal.component';

const PAGE_SIZE = 30;

export const MEDIA_KIND_OPTIONS: IFilterOption<MediaKind | ''>[] = [
  { value: '', label: 'Todos' },
  ...(['VIDEO', 'IMAGE', 'DOCUMENT'] as const).map(kind => ({ value: kind, label: MEDIA_KIND_META[kind].plural }))
];

/** Elegir medios de la biblioteca para la publicación (en el orden en que se marcan). */
@Component({
  selector: 'ym-media-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncStateComponent, FilterChipsComponent, IconComponent, MediaThumbComponent, ModalComponent],
  template: `
    <ym-modal title="Añadir medios de la biblioteca" [width]="760" (closed)="closed.emit()">
      <ym-icon modal-icon name="images" [size]="20" class="text-brand" />
      <div class="flex flex-wrap items-center gap-2">
        <label class="relative min-w-0 flex-1">
          <span class="sr-only">Buscar medios</span>
          <ym-icon name="search" [size]="14" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 muted" />
          <input type="search" class="input pl-8" placeholder="Buscar por título o archivo…" [value]="search()" (input)="search.set($any($event.target).value)" />
        </label>
        <ym-filter-chips ariaLabel="Tipo" [options]="kindOptions" [value]="kind()" (valueChange)="setKind($event)" />
      </div>
      <ym-async-state [loader]="items" [isEmpty]="available().length === 0" emptyText="No hay medios con estos filtros.">
        <ul class="grid max-h-[55vh] grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 overflow-y-auto p-0.5">
          @for (m of available(); track m.id) {
            @let order = position(m.id);
            <li>
              <button type="button" class="relative block w-full overflow-hidden rounded-lg border text-left transition"
                      [class]="order ? 'border-brand ring-2 ring-brand/40' : 'border-line hover:border-brand'"
                      [attr.aria-pressed]="!!order" (click)="toggle(m)">
                <ym-media-thumb [media]="m" [compact]="true" [showKind]="true" />
                @if (order) { <span class="absolute left-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-white">{{ order }}</span> }
                <span class="block truncate px-1.5 py-1 text-[11px]" [title]="m.title">{{ m.title }}</span>
              </button>
            </li>
          }
        </ul>
        @if (items.hasMore()) {
          <div class="pt-2 text-center"><button type="button" class="btn btn-sm" (click)="items.loadMore()">Cargar más</button></div>
        }
      </ym-async-state>
      <ng-container modal-footer>
        <span class="flex-1 text-xs muted">No se mezclan videos, imágenes y PDF en una misma publicación.</span>
        <button type="button" class="btn" (click)="closed.emit()">Cancelar</button>
        <button type="button" class="btn btn-primary" [disabled]="!chosen().length" (click)="picked.emit(chosen())">
          Añadir @if (chosen().length) { {{ chosen().length }} }
        </button>
      </ng-container>
    </ym-modal>
  `
})
export class MediaPickerDialog implements OnInit {
  private readonly http = inject(VideoHttp);
  private readonly destroyRef = inject(DestroyRef);

  /** Ya están en la publicación: no se ofrecen. */
  readonly exclude = input<readonly number[]>([]);
  readonly picked = output<IVideo[]>();
  readonly closed = output<void>();

  protected readonly kindOptions = MEDIA_KIND_OPTIONS;
  protected readonly search = signal('');
  /** Creado aquí: toObservable necesita el contexto de inyección (no vale en ngOnInit). */
  private readonly search$ = toObservable(this.search);
  protected readonly kind = signal<MediaKind | ''>('');
  protected readonly chosen = signal<IVideo[]>([]);

  protected readonly items = createPagedLoader(
    (offset, take) => this.http.page({ searchTerm: this.search().trim() || undefined, kind: this.kind(), sort: 'NEWEST', offset, take }),
    { take: PAGE_SIZE, errorMessage: 'No se pudo cargar la biblioteca.' }
  );
  protected readonly available = computed(() => (this.items.value() ?? []).filter(m => !this.exclude().includes(m.id)));

  ngOnInit(): void {
    this.search$.pipe(skip(1), debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.items.reset());
    this.items.reload();
  }

  protected setKind(kind: MediaKind | ''): void {
    this.kind.set(kind);
    this.items.reset();
  }

  /** Número de orden (1, 2…) o 0 si no está marcado. */
  protected position(id: number): number {
    return this.chosen().findIndex(m => m.id === id) + 1;
  }

  protected toggle(media: IVideo): void {
    this.chosen.update(list => (list.some(m => m.id === media.id) ? list.filter(m => m.id !== media.id) : [...list, media]));
  }
}
