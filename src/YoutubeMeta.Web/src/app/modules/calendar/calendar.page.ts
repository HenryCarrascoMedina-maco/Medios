import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime, filter, firstValueFrom, merge } from 'rxjs';
import { MEDIA_KIND_META, PLATFORM_META, POST_KIND_META } from '@core/constants/status.constants';
import { PublicationHttp, VideoHttp } from '@core/http/api.http';
import { ICalendarItem, IVideo } from '@core/models/api.models';
import { ClockService } from '@core/services/clock.service';
import { ConfirmService } from '@core/services/confirm.service';
import { EntityHubService } from '@core/services/entity-hub.service';
import { ToastService } from '@core/services/toast.service';
import { addDays, dayKey, isSameDay, monthGrid, moveToDay, startOfDay, suggestedTimeOnDay, weekDays } from '@core/utils/dates';
import { apiError, toLocalInput } from '@core/utils/format';
import { mediaKindOf } from '@core/utils/post-kind';
import { createLoader } from '@core/utils/loader';
import { readStored, writeStored } from '@core/utils/storage';
import { PublishDialog } from '@shared/publish/publish.dialog';
import { createPublishLauncher } from '@shared/publish/publish-launcher';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { FilterChipsComponent, IFilterOption } from '@shared/ui/filter-chips.component';
import { IconComponent } from '@shared/ui/icon.component';
import { ModalComponent } from '@shared/ui/modal.component';
import { PlatformBadgeComponent } from '@shared/ui/platform-badge.component';
import { PostKindBadgeComponent } from '@shared/ui/post-kind-badge.component';
import { ScheduleFieldComponent } from '@shared/ui/schedule-field.component';
import { StatusChipComponent } from '@shared/ui/status-chip.component';

type CalendarView = 'month' | 'week';
const VIEW_KEY = 'ym.calendar.view';
const DRAG_TYPE = 'application/x-ym-calendar';
const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

/** Lo que se arrastra: una publicación (reprogramar) o un video sin publicar (programarlo). */
type DragPayload = { kind: 'publication'; id: number } | { kind: 'video'; id: number };

interface IDayCell {
  date: Date;
  key: string;
  inMonth: boolean;
  today: boolean;
  past: boolean;
  items: ICalendarItem[];
}

/**
 * Calendario de publicaciones (vista mes o semana, hora local). Se puede arrastrar una publicación
 * programada a otro día (conserva la hora) y arrastrar un video sin publicar a un día para abrir el
 * diálogo de publicación con esa fecha.
 */
@Component({
  selector: 'ym-calendar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, RouterLink, AsyncStateComponent, FilterChipsComponent, IconComponent, ModalComponent, PlatformBadgeComponent,
    ScheduleFieldComponent, StatusChipComponent, PublishDialog, PostKindBadgeComponent
  ],
  templateUrl: './calendar.page.html'
})
export class CalendarPage implements OnInit {
  private readonly http = inject(PublicationHttp);
  private readonly videosHttp = inject(VideoHttp);
  private readonly hub = inject(EntityHubService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly clock = inject(ClockService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly publish = createPublishLauncher();

  protected readonly meta = PLATFORM_META;
  protected readonly kindMeta = POST_KIND_META;
  protected readonly weekdays = WEEKDAYS;
  protected readonly mediaIcon = (v: IVideo) => MEDIA_KIND_META[mediaKindOf(v)].icon;
  protected readonly viewOptions: IFilterOption<CalendarView>[] = [{ value: 'month', label: 'Mes' }, { value: 'week', label: 'Semana' }];

  protected readonly view = signal<CalendarView>(readStored<CalendarView>(VIEW_KEY, 'month'));
  protected readonly cursor = signal(startOfDay(new Date()));
  protected readonly selected = signal<ICalendarItem | null>(null);
  protected readonly rescheduleTo = signal('');
  protected readonly dropTarget = signal<string | null>(null);
  protected readonly sideOpen = signal(true);
  protected readonly moving = signal<number | null>(null);

  protected readonly days = computed(() => (this.view() === 'month' ? monthGrid(this.cursor()) : weekDays(this.cursor())));
  private readonly range = computed(() => {
    const days = this.days();
    return { from: days[0].toISOString(), to: addDays(days[days.length - 1], 1).toISOString() };
  });

  protected readonly items = createLoader(() => this.http.calendar(this.range().from, this.range().to), { errorMessage: 'No se pudo cargar el calendario.' });
  /** Medios sin publicar (videos, imágenes o PDF), para arrastrarlos a un día. */
  protected readonly pending = createLoader(() => this.videosHttp.page({ status: 'UNPUBLISHED', sort: 'NEWEST', take: 50 }), { errorMessage: 'No se pudieron cargar los medios.' });

  protected readonly cells = computed<IDayCell[]>(() => {
    const byDay = new Map<string, ICalendarItem[]>();
    for (const item of this.items.value() ?? []) {
      const key = dayKey(new Date(item.when));
      byDay.set(key, [...(byDay.get(key) ?? []), item]);
    }
    const today = new Date(this.clock.now());
    const month = this.cursor().getMonth();
    return this.days().map(date => ({
      date,
      key: dayKey(date),
      inMonth: this.view() === 'week' || date.getMonth() === month,
      today: isSameDay(date, today),
      past: date < startOfDay(today),
      items: (byDay.get(dayKey(date)) ?? []).sort((a, b) => a.when.localeCompare(b.when))
    }));
  });

  protected readonly title = computed(() => {
    const days = this.days();
    if (this.view() === 'month') return this.cursor().toLocaleDateString('es', { month: 'long', year: 'numeric' });
    const first = days[0];
    const last = days[days.length - 1];
    return `${first.toLocaleDateString('es', { day: 'numeric', month: 'short' })} – ${last.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  });

  ngOnInit(): void {
    merge(this.hub.publishUpdates().pipe(filter(u => u.isFinal)), this.hub.reconnected$)
      .pipe(debounceTime(600), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.items.reload());
    this.items.reload();
    this.pending.reload();
  }

  protected setView(view: CalendarView): void {
    this.view.set(view);
    writeStored(VIEW_KEY, view);
    this.items.reset();
  }

  protected move(step: -1 | 0 | 1): void {
    const current = this.cursor();
    if (step === 0) this.cursor.set(startOfDay(new Date()));
    else if (this.view() === 'month') this.cursor.set(new Date(current.getFullYear(), current.getMonth() + step, 1));
    else this.cursor.set(addDays(current, 7 * step));
    this.items.reset();
  }

  protected open(item: ICalendarItem): void {
    this.selected.set(item);
    this.rescheduleTo.set(item.publishAt ? toLocalInput(new Date(item.publishAt)) : '');
  }

  // ── Arrastrar y soltar ──────────────────────────────────────────────────
  protected dragStart(event: DragEvent, payload: DragPayload): void {
    event.dataTransfer?.setData(DRAG_TYPE, JSON.stringify(payload));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected dragOver(event: DragEvent, cell: IDayCell): void {
    if (cell.past || !event.dataTransfer?.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    this.dropTarget.set(cell.key);
  }

  protected async drop(event: DragEvent, cell: IDayCell): Promise<void> {
    event.preventDefault();
    this.dropTarget.set(null);
    const raw = event.dataTransfer?.getData(DRAG_TYPE);
    if (!raw || cell.past) return;
    const payload = JSON.parse(raw) as DragPayload;
    if (payload.kind === 'video') {
      const video = this.pending.value()?.items.find(v => v.id === payload.id);
      if (video) void this.publish.open([video], { start: suggestedTimeOnDay(cell.date, this.clock.now()), intervalMs: 0 });
      return;
    }
    const item = this.items.value()?.find(i => i.id === payload.id);
    if (!item?.canReschedule || isSameDay(new Date(item.when), cell.date)) return;
    await this.reschedule(item, moveToDay(new Date(item.when), cell.date));
  }

  /** Desde el panel: alternativa con teclado a arrastrar. */
  protected async rescheduleSelected(): Promise<void> {
    const item = this.selected();
    if (!item || !this.rescheduleTo()) return;
    if (await this.reschedule(item, new Date(this.rescheduleTo()))) this.selected.set(null);
  }

  protected onPublished(): void {
    this.publish.close();
    this.items.reload();
    this.pending.reload();
  }

  /** Confirma, mueve en pantalla y llama al servidor; si falla, vuelve a su sitio. */
  private async reschedule(item: ICalendarItem, to: Date): Promise<boolean> {
    const accepted = await this.confirm.ask({
      title: 'Reprogramar publicación',
      message: `«${item.title}» en ${item.connectionName} (${PLATFORM_META[item.target].label}) pasará al ${to.toLocaleString('es', { dateStyle: 'full', timeStyle: 'short' })}.`,
      confirmText: 'Reprogramar'
    });
    if (!accepted) return false;
    const iso = to.toISOString();
    const replace = (row: ICalendarItem) => this.items.value.update(list => list?.map(i => (i.id === item.id ? row : i)));
    replace({ ...item, when: iso, publishAt: iso });
    this.moving.set(item.id);
    try {
      replace(await firstValueFrom(this.http.reschedule(item.id, iso)));
      this.toast.success('Publicación reprogramada.');
      return true;
    } catch (error) {
      replace(item);
      this.toast.error(apiError(error, 'No se pudo reprogramar.'));
      return false;
    } finally {
      this.moving.set(null);
    }
  }
}
