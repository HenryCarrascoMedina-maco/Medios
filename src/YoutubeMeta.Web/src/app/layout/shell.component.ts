import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { debounceTime, filter, firstValueFrom, merge } from 'rxjs';
import { PublicationHttp } from '@core/http/api.http';
import { INotification } from '@core/models/api.models';
import { HEALTH_META } from '@core/constants/status.constants';
import { BrowserNotificationService } from '@core/services/browser-notification.service';
import { EntityHubService } from '@core/services/entity-hub.service';
import { HealthService } from '@core/services/health.service';
import { InboxCountsService } from '@core/services/inbox-counts.service';
import { RulesService } from '@core/services/rules.service';
import { ThemeService } from '@core/services/theme.service';
import { SessionService } from '@core/session/session.service';
import { IconComponent } from '@shared/ui/icon.component';
import { IconName } from '@shared/ui/icons';
import { StatusChipComponent } from '@shared/ui/status-chip.component';
import { SessionDialogComponent } from './session-dialog.component';

interface INavItem {
  path: string;
  label: string;
  icon: IconName;
  /** Contador junto al nombre: conversaciones sin leer o publicaciones en curso. */
  badge?: 'inbox' | 'publications';
  /** En la barra inferior del móvil (el resto va en «Más»). */
  mobile?: boolean;
}

interface INavGroup {
  label: string | null;
  items: readonly INavItem[];
}

export const NAV: readonly INavGroup[] = [
  {
    label: null,
    items: [
      { path: '/home', label: 'Inicio', icon: 'home', mobile: true },
      { path: '/inbox', label: 'Bandeja', icon: 'inbox', badge: 'inbox', mobile: true }
    ]
  },
  {
    label: 'Publicar',
    items: [
      { path: '/library', label: 'Medios', icon: 'images', mobile: true },
      { path: '/publications', label: 'Publicaciones', icon: 'broadcast', badge: 'publications' },
      { path: '/calendar', label: 'Calendario', icon: 'calendar' }
    ]
  },
  { label: 'Análisis', items: [{ path: '/insights', label: 'Resultados', icon: 'chart', mobile: true }] },
  {
    label: 'Configuración',
    items: [
      { path: '/connections', label: 'Conexiones', icon: 'link' },
      { path: '/settings', label: 'Ajustes', icon: 'sliders' },
      { path: '/guides', label: 'Guías', icon: 'book' }
    ]
  }
];

@Component({
  selector: 'ym-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DatePipe, StatusChipComponent, IconComponent, SessionDialogComponent],
  templateUrl: './shell.component.html',
  host: { '(document:click)': 'closeMenus()', '(document:keydown.escape)': 'closeMenus()' }
})
export class ShellComponent implements OnInit {
  private readonly hub = inject(EntityHubService);
  private readonly publications = inject(PublicationHttp);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly session = inject(SessionService);
  protected readonly theme = inject(ThemeService);
  protected readonly browserNotifications = inject(BrowserNotificationService);
  private readonly healthService = inject(HealthService);
  private readonly rules = inject(RulesService);
  private readonly inboxCounts = inject(InboxCountsService);
  /** Punto de salud en la cabecera: solo si hay algo que mirar (warn/error). */
  protected readonly healthAlert = computed(() => {
    const health = this.healthService.health();
    return health && health.status !== 'ok' ? { ...HEALTH_META[health.status], alerts: health.alerts } : null;
  });

  protected readonly connected = this.hub.connected;
  protected readonly notifications = signal<INotification[]>([]);
  protected readonly notificationsOpen = signal(false);
  /** Móvil: menú «Más» con lo que no cabe en la barra inferior. */
  protected readonly moreOpen = signal(false);
  protected readonly unread = computed(() => this.notifications().filter(n => !n.isRead).length);
  protected readonly activeCount = signal(0);
  protected readonly initials = computed(() => (this.session.user()?.displayName ?? 'A').slice(0, 2).toUpperCase());

  protected readonly nav = NAV;
  protected readonly mobileNav = NAV.flatMap(g => g.items).filter(i => i.mobile);
  protected readonly moreNav = NAV.flatMap(g => g.items).filter(i => !i.mobile);
  protected readonly inboxUnread = computed(() => this.inboxCounts.counts().unread);

  protected badge(item: INavItem): number {
    if (item.badge === 'inbox') return this.inboxUnread();
    if (item.badge === 'publications') return this.activeCount();
    return 0;
  }

  constructor() {
    // El hub se (re)arranca cada vez que la sesión vuelve a ser válida (al entrar o tras reautenticar).
    effect(() => {
      if (this.session.isAuthenticated()) untracked(() => this.hub.start());
    });
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.hub.stop());

    void this.refresh();
    void this.rules.ensure();
    this.healthService.poll(this.destroyRef);
    this.inboxCounts.watch(this.destroyRef);
    this.hub.on('Inbox').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(u => void this.browserNotifications.notifyInbox(u));
    this.hub.publishUpdates()
      .pipe(filter(u => u.isFinal), takeUntilDestroyed(this.destroyRef))
      .subscribe(u => void this.browserNotifications.notify(u));
    merge(this.hub.publishUpdates().pipe(filter(u => u.isFinal)), this.hub.reconnected$)
      .pipe(debounceTime(600), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.refresh());
  }

  protected closeMenus(): void {
    this.notificationsOpen.set(false);
    this.moreOpen.set(false);
  }

  protected toggleMore(event: Event): void {
    event.stopPropagation();
    this.notificationsOpen.set(false);
    this.moreOpen.update(open => !open);
  }

  protected toggleNotifications(event: Event): void {
    event.stopPropagation();
    const open = !this.notificationsOpen();
    this.moreOpen.set(false);
    this.notificationsOpen.set(open);
    if (open && this.unread() > 0) {
      void firstValueFrom(this.publications.notificationsRead()).then(() =>
        this.notifications.update(list => list.map(n => ({ ...n, isRead: true }))));
    }
  }

  protected openNotification(notification: INotification): void {
    this.notificationsOpen.set(false);
    // Sin medios (texto o enlace) no hay ficha de video: se abre la lista de publicaciones.
    void this.router.navigate(notification.videoId != null ? ['/videos', notification.videoId] : ['/publications']);
  }

  protected logout(): void {
    this.hub.stop();
    this.session.logout();
  }

  private async refresh(): Promise<void> {
    try {
      const [notifications, active] = await Promise.all([
        firstValueFrom(this.publications.notifications()),
        firstValueFrom(this.publications.list({ group: 'ACTIVE' }))
      ]);
      this.notifications.set(notifications);
      this.activeCount.set(active.length);
    } catch {
      // Sin red: se reintenta con el próximo evento o al reconectar.
    }
  }
}
