import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { IVideo } from '@core/models/api.models';
import { ClockService } from '@core/services/clock.service';
import { DAY_MS, HOUR_MS, seriesSchedule } from '@core/utils/dates';
import { toLocalInput } from '@core/utils/format';
import { IPublishSchedule } from '@shared/publish/publish.dialog';
import { ChoiceGroupComponent, IChoice } from '@shared/ui/choice-group.component';
import { IconComponent } from '@shared/ui/icon.component';
import { ModalComponent } from '@shared/ui/modal.component';
import { ScheduleFieldComponent } from '@shared/ui/schedule-field.component';
import { ReqComponent } from '@shared/ui/req.component';

type Unit = 'h' | 'd';
const UNITS: readonly IChoice<Unit>[] = [{ value: 'h', label: 'horas' }, { value: 'd', label: 'días' }];

/**
 * «Programar en serie»: primer video a una fecha y los siguientes cada N horas o días. Al confirmar
 * se abre el diálogo de publicación con esas fechas (allí se validan con las reglas de cada cuenta).
 */
@Component({
  selector: 'ym-series-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ModalComponent, IconComponent, ChoiceGroupComponent, ScheduleFieldComponent, ReqComponent],
  template: `
    <ym-modal [title]="'Programar ' + videos().length + ' videos en serie'" [width]="520" (closed)="closed.emit()">
      <ym-icon modal-icon name="calendar" [size]="20" class="text-brand" />
      <ym-schedule-field label="Primer video" hint="" [required]="true" [minLeadMs]="15 * 60_000" [(value)]="start" />
      <div class="flex flex-wrap items-end gap-2">
        <div>
          <label class="label" for="series-every">Uno cada <ym-req /></label>
          <input id="series-every" type="number" min="1" max="365" class="input !w-24" [value]="every()" (input)="every.set(+$any($event.target).value)" />
        </div>
        <ym-choice-group ariaLabel="Unidad" [options]="units" [(value)]="unit" />
      </div>
      @if (dates().length) {
        <ol class="max-h-56 overflow-y-auto rounded-lg bg-field p-2 text-xs">
          @for (d of dates(); track $index) {
            <li class="flex justify-between gap-2 py-0.5"><span class="truncate">{{ videos()[$index].title }}</span><b class="shrink-0">{{ d | date: 'EEE dd/MM/yyyy HH:mm' }}</b></li>
          }
        </ol>
      }
      <ng-container modal-footer>
        <button type="button" class="btn" (click)="closed.emit()">Cancelar</button>
        <button type="button" class="btn btn-primary" [disabled]="!valid()" (click)="confirm()">Elegir cuentas…</button>
      </ng-container>
    </ym-modal>
  `
})
export class SeriesDialogComponent {
  private readonly clock = inject(ClockService);

  readonly videos = input.required<IVideo[]>();
  readonly closed = output<void>();
  readonly confirmed = output<IPublishSchedule>();

  protected readonly units = UNITS;
  /** Por defecto: mañana a las 10:00, uno al día. */
  protected readonly start = signal(toLocalInput(defaultStart(this.clock.now())));
  protected readonly every = signal(1);
  protected readonly unit = signal<Unit | null>('d');

  private readonly intervalMs = computed(() => Math.max(0, this.every()) * (this.unit() === 'h' ? HOUR_MS : DAY_MS));
  protected readonly valid = computed(() => !!this.start() && new Date(this.start()).getTime() > this.clock.now() && this.intervalMs() > 0);
  protected readonly dates = computed(() => (this.start() ? seriesSchedule(new Date(this.start()), this.intervalMs(), this.videos().length) : []));

  protected confirm(): void {
    if (this.valid()) this.confirmed.emit({ start: new Date(this.start()), intervalMs: this.intervalMs() });
  }
}

function defaultStart(now: number): Date {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return date;
}
