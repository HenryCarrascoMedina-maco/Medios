import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DEFAULT_LANE_STALE_MINUTES, HEALTH_META, JOB_LANES, PLATFORM_META } from '@core/constants/status.constants';
import { InsightsHttp, PublicationHttp } from '@core/http/api.http';
import { ClockService } from '@core/services/clock.service';
import { HealthService } from '@core/services/health.service';
import { ToastService } from '@core/services/toast.service';
import { addDays, startOfDay } from '@core/utils/dates';
import { datedFileName, downloadBlob } from '@core/utils/download';
import { apiError, formatAgo, formatBytes, percentOf } from '@core/utils/format';
import { formatMinutes } from '@core/utils/inbox';
import { createLoader } from '@core/utils/loader';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { BarChartComponent, IBarSeries } from '@shared/ui/bar-chart.component';
import { ChipComponent } from '@shared/ui/chip.component';
import { FilterChipsComponent, IFilterOption } from '@shared/ui/filter-chips.component';
import { IconComponent } from '@shared/ui/icon.component';
import { KpiTileComponent } from '@shared/ui/kpi-tile.component';
import { PlatformBadgeComponent } from '@shared/ui/platform-badge.component';
import { ProgressBarComponent } from '@shared/ui/progress-bar.component';

const SERIES: IBarSeries[] = [
  { name: 'Publicadas', fill: 'fill-green-500' },
  { name: 'Fallidas', fill: 'fill-red-500' }
];

/** Resultados: cifras del periodo, gráfico diario, tabla por cuenta y salud del sistema. */
@Component({
  selector: 'ym-insights-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe, RouterLink, AccountAvatarComponent, AsyncStateComponent, BarChartComponent, ChipComponent, FilterChipsComponent, IconComponent,
    KpiTileComponent, PlatformBadgeComponent, ProgressBarComponent
  ],
  templateUrl: './insights.page.html'
})
export class InsightsPage implements OnInit {
  private readonly http = inject(InsightsHttp);
  private readonly publications = inject(PublicationHttp);
  private readonly healthService = inject(HealthService);
  private readonly toast = inject(ToastService);
  private readonly clock = inject(ClockService);
  protected readonly meta = PLATFORM_META;

  protected readonly periods: IFilterOption<number>[] = [7, 30, 90].map(days => ({ value: days, label: `${days} días` }));
  protected readonly series = SERIES;
  protected readonly healthMeta = HEALTH_META;
  protected readonly formatBytes = formatBytes;
  protected readonly formatMinutes = formatMinutes;
  protected readonly days = signal(30);
  protected readonly exporting = signal(false);

  protected readonly insights = createLoader(() => this.http.get(this.days()), { errorMessage: 'No se pudieron cargar los resultados.' });
  protected readonly health = createLoader(() => this.http.health(), { errorMessage: 'No se pudo leer el estado del sistema.' });

  protected readonly chartData = computed(() =>
    (this.insights.value()?.daily ?? []).map(d => {
      const [, month, day] = d.day.slice(0, 10).split('-');
      return { label: `${day}/${month}`, values: [d.done, d.failed] };
    }));

  protected readonly quota = computed(() => {
    const h = this.health.value();
    if (!h) return null;
    return {
      uploads: percentOf(h.youtubeUploadsUsed, h.youtubeUploadsLimit),
      units: percentOf(h.youtubeUnitsUsed, h.youtubeUnitsLimit),
      storage: percentOf(h.storageUsedBytes, h.storageUsedBytes + h.storageFreeBytes)
    };
  });

  /** Frescura de cada carril del job: cuándo trabajó por última vez. */
  protected readonly lanes = computed(() => {
    const now = this.clock.now();
    return Object.entries(this.health.value()?.jobLanes ?? {}).map(([lane, at]) => {
      const meta = JOB_LANES[lane];
      return {
        lane,
        label: meta?.label ?? lane,
        ago: formatAgo(at, now),
        stale: !at || now - Date.parse(at) > (meta?.staleMinutes ?? DEFAULT_LANE_STALE_MINUTES) * 60_000
      };
    });
  });

  constructor() {
    // Lo que se ve aquí también actualiza el punto de la cabecera.
    effect(() => {
      const h = this.health.value();
      if (h) untracked(() => this.healthService.set(h));
    });
  }

  ngOnInit(): void {
    this.insights.reload();
    this.health.reload();
  }

  protected setDays(days: number): void {
    this.days.set(days);
    this.insights.reload();
  }

  /** CSV de las publicaciones del periodo elegido. */
  protected async exportCsv(): Promise<void> {
    this.exporting.set(true);
    try {
      const from = addDays(startOfDay(new Date(this.clock.now())), -this.days() + 1).toISOString();
      downloadBlob(await firstValueFrom(this.publications.exportCsv({ from })), datedFileName(`resultados-${this.days()}d`, 'csv'));
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudo exportar.'));
    } finally {
      this.exporting.set(false);
    }
  }
}
