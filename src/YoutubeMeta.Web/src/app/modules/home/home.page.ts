import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime, merge } from 'rxjs';
import { HEALTH_META, STATUS_META } from '@core/constants/status.constants';
import { HomeHttp } from '@core/http/api.http';
import { IInboxConversation } from '@core/models/api.models';
import { ClockService } from '@core/services/clock.service';
import { EntityHubService } from '@core/services/entity-hub.service';
import { HealthService } from '@core/services/health.service';
import { SessionService } from '@core/session/session.service';
import { addDays, startOfDay } from '@core/utils/dates';
import { conversationName, formatMinutes, windowState } from '@core/utils/inbox';
import { createLoader } from '@core/utils/loader';
import { formatAgo } from '@core/utils/format';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { BarChartComponent, IBarSeries } from '@shared/ui/bar-chart.component';
import { ChipComponent } from '@shared/ui/chip.component';
import { IconComponent } from '@shared/ui/icon.component';
import { KpiTileComponent } from '@shared/ui/kpi-tile.component';
import { PlatformBadgeComponent } from '@shared/ui/platform-badge.component';
import { createPublishLauncher } from '@shared/publish/publish-launcher';
import { PublishDialog } from '@shared/publish/publish.dialog';

/**
 * Inicio: lo urgente de la bandeja, lo que se publica hoy, lo que falló y la salud, con un enlace a cada módulo.
 * Una sola llamada (GET /api/Home/Summary); se recarga con los eventos del hub.
 */
@Component({
  selector: 'ym-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, RouterLink, AccountAvatarComponent, AsyncStateComponent, BarChartComponent, ChipComponent, IconComponent, KpiTileComponent, PlatformBadgeComponent,
    PublishDialog
  ],
  templateUrl: './home.page.html'
})
export class HomePage implements OnInit {
  private readonly http = inject(HomeHttp);
  private readonly hub = inject(EntityHubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly clock = inject(ClockService);
  protected readonly session = inject(SessionService);
  protected readonly healthService = inject(HealthService);
  protected readonly publish = createPublishLauncher();

  protected readonly statusMeta = STATUS_META;
  protected readonly healthMeta = HEALTH_META;
  protected readonly name = conversationName;
  protected readonly formatMinutes = formatMinutes;
  protected readonly formatAgo = formatAgo;

  protected readonly summary = createLoader(() => {
    const today = startOfDay(new Date());
    return this.http.summary(today, addDays(today, 1));
  }, { errorMessage: 'No se pudo cargar el inicio.' });

  protected readonly greeting = computed(() => {
    const hour = new Date(this.clock.now()).getHours();
    const name = this.session.user()?.displayName ?? '';
    return `${hour < 12 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches'}${name ? `, ${name}` : ''}`;
  });

  /** Variación del tiempo de respuesta frente a la semana anterior (negativo = más rápido). */
  protected readonly responseDelta = computed(() => {
    const k = this.summary.value()?.kpis;
    if (k?.avgResponseMinutes == null || k.avgResponseMinutesPrevious == null) return null;
    return Math.round(k.avgResponseMinutes - k.avgResponseMinutesPrevious);
  });

  protected readonly chartSeries: readonly IBarSeries[] = [
    { name: 'Mensajes recibidos', fill: 'fill-sky-500' },
    { name: 'Publicaciones', fill: 'fill-brand' }
  ];
  protected readonly chartData = computed(() => (this.summary.value()?.activity ?? []).map(d => ({
    label: new Date(d.day).toLocaleDateString(undefined, { weekday: 'short' }),
    values: [d.received, d.published]
  })));

  ngOnInit(): void {
    merge(this.hub.on('Inbox'), this.hub.publishUpdates(), this.hub.on('Connection'), this.hub.reconnected$)
      .pipe(debounceTime(1500), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.summary.reload());
    this.summary.reload();
  }

  protected window(conversation: IInboxConversation) {
    return windowState(conversation, this.clock.now());
  }

  protected newPublication(): void {
    void this.publish.open([], null, { asPost: true });
  }
}
