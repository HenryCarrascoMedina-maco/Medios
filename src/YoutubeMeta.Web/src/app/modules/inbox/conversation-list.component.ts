import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';
import { INBOX_KIND_META, PLATFORM_META } from '@core/constants/status.constants';
import { InboxKind, InboxStatus, Platform } from '@core/models/api.models';
import { ClockService } from '@core/services/clock.service';
import { InboxCountsService } from '@core/services/inbox-counts.service';
import { RulesService } from '@core/services/rules.service';
import { isSameDay } from '@core/utils/dates';
import { conversationName, windowState } from '@core/utils/inbox';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { ChipComponent } from '@shared/ui/chip.component';
import { FilterChipsComponent, IFilterOption } from '@shared/ui/filter-chips.component';
import { IconComponent } from '@shared/ui/icon.component';
import { InfiniteScrollDirective } from '@shared/ui/infinite-scroll.directive';
import { InboxStore } from './inbox.store';

/** Columna izquierda de la bandeja: buscador, filtros (estado, red, tipo) y conversaciones con scroll infinito. */
@Component({
  selector: 'ym-conversation-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, AccountAvatarComponent, AsyncStateComponent, ChipComponent, FilterChipsComponent, IconComponent, InfiniteScrollDirective],
  host: { class: 'flex min-h-0 flex-col' },
  template: `
    @let f = store.filters();
    <div class="grid gap-2 border-b border-line p-3">
      <label class="relative">
        <span class="sr-only">Buscar en la bandeja</span>
        <ym-icon name="search" [size]="14" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 muted" />
        <input type="search" class="input pl-8" placeholder="Buscar persona o texto…" [value]="search()" (input)="search.set($any($event.target).value)" />
      </label>
      <ym-filter-chips ariaLabel="Estado" [options]="statusOptions()" [value]="f.status" (valueChange)="store.setFilters({ status: $event })" />
      <ym-filter-chips ariaLabel="Red" [options]="platformOptions()" [value]="f.platform" (valueChange)="store.setFilters({ platform: $event })" />
      <div class="flex flex-wrap items-center gap-1.5">
        <ym-filter-chips ariaLabel="Tipo" [options]="kindOptions" [value]="f.kind" (valueChange)="store.setFilters({ kind: $event })" />
        <label class="ml-auto flex items-center gap-1 text-xs"><input type="checkbox" [checked]="f.unread" (change)="store.setFilters({ unread: !f.unread })" /> Sin leer</label>
        <label class="flex items-center gap-1 text-xs"><input type="checkbox" [checked]="f.awaiting" (change)="store.setFilters({ awaiting: !f.awaiting })" /> Sin responder</label>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <ym-async-state [loader]="store.conversations" [isEmpty]="!(store.conversations.value()?.length)" emptyText="No hay conversaciones con estos filtros.">
        <ul role="list">
          @for (c of store.conversations.value() ?? []; track c.id) {
            @let w = window(c);
            <li>
              <button type="button" class="flex w-full gap-2.5 border-b border-line-soft px-3 py-2.5 text-left hover:bg-surface-hover"
                      [class]="c.id === store.selectedId() ? 'bg-brand-soft shadow-[inset_3px_0_0_#ff8a00] dark:bg-brand/15' : ''"
                      [attr.aria-current]="c.id === store.selectedId() ? 'true' : null" (click)="open.emit(c.id)">
                <ym-account-avatar [platform]="c.platform" [name]="name(c)" [url]="c.contactAvatarUrl" [size]="36" />
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-1">
                    <b class="truncate text-sm" [class.font-bold]="c.unreadCount > 0" [class.font-medium]="!c.unreadCount">{{ name(c) }}</b>
                    @if (c.kind !== 'DIRECT') { <ym-chip tone="outline">{{ kindMeta[c.kind].label }}</ym-chip> }
                  </span>
                  <span class="block truncate text-xs muted">{{ c.lastMessagePreview }}</span>
                  <span class="block truncate text-[11px] muted">{{ meta[c.platform].label }} · {{ c.accountName }}</span>
                </span>
                <span class="flex shrink-0 flex-col items-end gap-1 text-[11px] muted">
                  {{ c.lastMessageAt | date: isToday(c.lastMessageAt) ? 'HH:mm' : 'dd/MM' }}
                  @if (c.unreadCount > 0) { <span class="rounded-full bg-brand px-1.5 font-bold text-white" [attr.aria-label]="c.unreadCount + ' sin leer'">{{ c.unreadCount }}</span> }
                  @if (w && w.tone !== 'neutral' && c.awaitingSince) { <ym-icon name="clock" [size]="12" [class]="w.closed ? 'text-red-500' : 'text-amber-500'" [label]="w.label" /> }
                </span>
              </button>
            </li>
          }
        </ul>
        @if (store.conversations.hasMore()) {
          <div ymInfiniteScroll (reached)="store.conversations.loadMore()" class="py-3 text-center text-xs muted">Cargando más…</div>
        }
      </ym-async-state>
    </div>
  `
})
export class ConversationListComponent implements OnInit {
  protected readonly store = inject(InboxStore);
  private readonly counts = inject(InboxCountsService);
  private readonly rules = inject(RulesService);
  private readonly clock = inject(ClockService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = output<number>();
  readonly initialSearch = input('');

  protected readonly meta = PLATFORM_META;
  protected readonly kindMeta = INBOX_KIND_META;
  protected readonly name = conversationName;
  protected readonly search = signal('');

  protected readonly statusOptions = computed<IFilterOption<InboxStatus | ''>[]>(() => {
    const c = this.counts.counts();
    return [
      { value: 'OPEN', label: 'Abiertas', count: c.open },
      { value: 'PENDING', label: 'Pendientes', count: c.pending },
      { value: 'CLOSED', label: 'Cerradas' },
      { value: '', label: 'Todas' }
    ];
  });

  protected readonly platformOptions = computed<IFilterOption<Platform | ''>[]>(() => [
    { value: '', label: 'Todas las redes' },
    ...this.rules.inboxPlatforms().map(p => ({ value: p, label: PLATFORM_META[p].label }))
  ]);

  protected readonly kindOptions: IFilterOption<InboxKind | ''>[] = [
    { value: '', label: 'Todo' },
    { value: 'DIRECT', label: 'Privados' },
    { value: 'COMMENTS', label: 'Comentarios' },
    { value: 'GROUP', label: 'Grupos' }
  ];

  constructor() {
    // toObservable solo vale en el contexto de inyección (constructor), no en ngOnInit.
    toObservable(this.search)
      .pipe(skip(1), debounceTime(350), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(searchTerm => this.store.setFilters({ searchTerm: searchTerm.trim() }));
  }

  ngOnInit(): void {
    this.search.set(this.initialSearch());
  }

  protected window(c: Parameters<typeof windowState>[0]) {
    return windowState(c, this.clock.now());
  }

  protected isToday(iso: string): boolean {
    return isSameDay(new Date(iso), new Date(this.clock.now()));
  }
}
