import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, debounceTime, firstValueFrom, forkJoin, merge } from 'rxjs';
import { ConnectionHttp, MetaPlatform, OAuthPlatform } from '@core/http/api.http';
import { OAUTH_CONNECT_REASON, OAUTH_RESULT_PARAMS, PLATFORM_META } from '@core/constants/status.constants';
import { IConnection, Platform } from '@core/models/api.models';
import { ConfirmService } from '@core/services/confirm.service';
import { EntityHubService } from '@core/services/entity-hub.service';
import { RulesService } from '@core/services/rules.service';
import { ToastService } from '@core/services/toast.service';
import { apiError, formatBytes, percentOf } from '@core/utils/format';
import { createLoader } from '@core/utils/loader';
import { isLinkedinPage, isTeamsWebhook } from '@core/utils/post-kind';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { ChipComponent } from '@shared/ui/chip.component';
import { IconComponent } from '@shared/ui/icon.component';
import { PlatformBadgeComponent } from '@shared/ui/platform-badge.component';
import { ProgressBarComponent } from '@shared/ui/progress-bar.component';
import { ConnectionCardComponent } from './connection-card.component';
import { MetaWizardDialog } from './meta-wizard.dialog';
import { QuickGuideComponent } from './quick-guide.component';
import { TeamsChannelsDialog } from './teams-channels.dialog';
import { TeamsWebhookDialog } from './teams-webhook.dialog';
import { TelegramWizardDialog } from './telegram-wizard.dialog';

@Component({
  selector: 'ym-connections-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, RouterLink, AsyncStateComponent, ChipComponent, IconComponent, PlatformBadgeComponent, ProgressBarComponent,
    ConnectionCardComponent, QuickGuideComponent, MetaWizardDialog, TelegramWizardDialog, TeamsChannelsDialog, TeamsWebhookDialog
  ],
  templateUrl: './connections.page.html'
})
export class ConnectionsPage implements OnInit {
  private readonly http = inject(ConnectionHttp);
  private readonly hub = inject(EntityHubService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Las que se pueden conectar en esta instalación (incluye WhatsApp; no las desactivadas). */
  protected readonly platforms = inject(RulesService).connectPlatforms;
  protected readonly meta = PLATFORM_META;
  protected readonly formatBytes = formatBytes;

  protected readonly data = createLoader(() => forkJoin({ status: this.http.status(), usage: this.http.usage() }), {
    errorMessage: 'No se pudieron cargar las conexiones.'
  });
  protected readonly busy = signal<string | null>(null);
  protected readonly guideOpen = signal<Partial<Record<Platform, boolean>>>({});
  /** Teams: pedir también permiso para leer las respuestas de los canales (bandeja; lo aprueba un administrador). */
  protected readonly teamsInbox = signal(false);
  protected readonly metaWizard = signal<MetaPlatform | null>(null);
  /** undefined = cerrado; null = canal nuevo; cuenta = reconectar ese canal. */
  protected readonly telegramWizard = signal<IConnection | null | undefined>(undefined);
  /** Código del inicio de sesión en Microsoft: abre el árbol de equipos y canales. */
  protected readonly teamsPick = signal<string | null>(null);
  /** undefined = cerrado; texto = nombre inicial del canal por webhook. */
  protected readonly teamsWebhook = signal<string | undefined>(undefined);

  protected readonly accountsByPlatform = computed(() => {
    const accounts = this.data.value()?.status.accounts ?? [];
    const result = {} as Record<Platform, IConnection[]>;
    for (const p of this.platforms()) result[p] = accounts.filter(a => a.platform === p);
    return result;
  });

  protected readonly uploadsPercent = computed(() => percentOf(this.data.value()?.usage.uploads, this.data.value()?.usage.uploadsLimit));
  protected readonly unitsPercent = computed(() => percentOf(this.data.value()?.usage.units, this.data.value()?.usage.unitsLimit));
  protected readonly storagePercent = computed(() => {
    const usage = this.data.value()?.usage;
    return usage ? percentOf(usage.storageUsedBytes, usage.storageUsedBytes + usage.storageFreeBytes) : 0;
  });

  constructor() {
    // Primera carga: la guía rápida se abre sola en las plataformas sin cuentas.
    const stop = effect(() => {
      const data = this.data.value();
      if (!data) return;
      untracked(() => {
        const open: Partial<Record<Platform, boolean>> = {};
        for (const p of this.platforms()) open[p] = !data.status.accounts.some(a => a.platform === p);
        this.guideOpen.set(open);
      });
      stop.destroy();
    });
  }

  ngOnInit(): void {
    this.readOAuthResult();
    merge(this.hub.on('Connection'), this.hub.on('Credential'), this.hub.reconnected$)
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.data.reload());
    this.data.reload();
  }

  protected setGuideOpen(key: Platform, open: boolean): void {
    this.guideOpen.update(state => ({ ...state, [key]: open }));
  }

  protected emptyText(platform: Platform): string {
    const m = PLATFORM_META[platform];
    return m.feminine ? `Todavía no hay ninguna ${m.noun} conectada.` : `Todavía no hay ningún ${m.noun} conectado.`;
  }

  /** Añadir una cuenta (o reconectar la misma): cada plataforma tiene su forma de entrar. */
  protected add(platform: Platform, account?: IConnection): void {
    switch (platform) {
      case 'YOUTUBE': void this.oauth('Youtube'); break;
      case 'TIKTOK': void this.oauth('Tiktok'); break;
      case 'FACEBOOK': this.metaWizard.set('Facebook'); break;
      case 'INSTAGRAM': this.metaWizard.set('Instagram'); break;
      case 'WHATSAPP': this.metaWizard.set('WhatsApp'); break;
      case 'TELEGRAM': this.telegramWizard.set(account ?? null); break;
      case 'LINKEDIN': void this.oauth(account && isLinkedinPage(account) ? 'LinkedinOrg' : 'Linkedin'); break;
      // Un canal por webhook se rehace pegando una URL nueva; uno de Graph vuelve a iniciar sesión.
      case 'TEAMS':
        if (account && isTeamsWebhook(account)) this.teamsWebhook.set(account.alias ?? account.displayName);
        else void this.oauth('Teams', this.teamsInbox());
        break;
    }
  }

  protected connectTeams(): void {
    void this.oauth('Teams', this.teamsInbox());
  }

  /** LinkedIn tiene dos entradas: el perfil personal y las páginas de empresa (otra app, aprobada por LinkedIn). */
  protected connectLinkedin(kind: 'Linkedin' | 'LinkedinOrg'): void {
    void this.oauth(kind);
  }

  /** Reconectar una cuenta: bloqueado si falta la app con la que se conectó. */
  protected reconnectBlocked(account: IConnection): boolean {
    const s = this.data.value()?.status;
    if (account.platform === 'LINKEDIN') return !(isLinkedinPage(account) ? s?.linkedinOrgConfigured : s?.linkedinConfigured);
    if (account.platform === 'TEAMS') return !isTeamsWebhook(account) && !s?.teamsConfigured;
    return !!this.needsSetup(account.platform);
  }

  protected needsSetup(platform: Platform): string | null {
    const s = this.data.value()?.status;
    if (!s) return null;
    if (platform === 'YOUTUBE' && !s.googleConfigured) return 'Falta el cliente OAuth de Google.';
    if (platform === 'TIKTOK' && !s.tiktokConfigured) return 'Falta la app de TikTok (Client key, secreto y RedirectUri https).';
    if (platform === 'LINKEDIN' && !s.linkedinConfigured && !s.linkedinOrgConfigured) return 'Falta la app de LinkedIn (Client ID y Client Secret).';
    return null;
  }

  protected async test(connection: IConnection): Promise<void> {
    this.busy.set(`test-${connection.id}`);
    try {
      const result = await firstValueFrom(this.http.test(connection.id));
      result.isOk ? this.toast.success(result.message) : this.toast.error(result.message);
      this.data.reload();
    } catch (error) {
      this.toast.error(apiError(error));
    } finally {
      this.busy.set(null);
    }
  }

  protected async setDefault(connection: IConnection): Promise<void> {
    await this.run(this.http.setDefault(connection.id), `«${connection.alias ?? connection.displayName}» viene marcada al publicar en ${PLATFORM_META[connection.platform].label}.`);
  }

  protected async saveAlias(connection: IConnection, alias: string | null): Promise<void> {
    await this.run(this.http.saveAlias(connection.id, alias));
  }

  protected async saveSignature(connection: IConnection, signature: string | null): Promise<void> {
    await this.run(this.http.saveSignature(connection.id, signature), 'Firma guardada.');
  }

  protected async disconnect(connection: IConnection): Promise<void> {
    const name = connection.alias ?? connection.displayName;
    const revokes = connection.platform === 'YOUTUBE' || connection.platform === 'TIKTOK';
    const accepted = await this.confirm.ask({
      title: `Quitar ${PLATFORM_META[connection.platform].noun}`,
      message: `Se borrará el token de «${name}»${revokes ? ' y se revocará el acceso en la plataforma' : ''}. Solo se cancelan las publicaciones que esperaban en esta cuenta; las demás cuentas no cambian.`,
      confirmText: 'Quitar',
      danger: true
    });
    if (!accepted) return;
    try {
      const result = await firstValueFrom(this.http.disconnect(connection.id));
      this.toast.success(result.message);
      this.data.reload();
    } catch (error) {
      this.toast.error(apiError(error));
    }
  }

  private async run(action: Observable<unknown>, success?: string): Promise<void> {
    try {
      await firstValueFrom(action);
      if (success) this.toast.success(success);
      this.data.reload();
    } catch (error) {
      this.toast.error(apiError(error));
    }
  }

  private async oauth(platform: OAuthPlatform, inbox = false): Promise<void> {
    this.busy.set(`oauth-${platform}`);
    try {
      window.location.href = await firstValueFrom(this.http.oauthUrl(platform, '/connections', inbox));
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudo iniciar la conexión.'));
      this.busy.set(null);
    }
  }

  /** Vuelta de Google, TikTok o LinkedIn: ?youtubeAccount|tiktokAccount|linkedinAccount=connected|reconnected|error&reason=… */
  private readOAuthResult(): void {
    const params = this.route.snapshot.queryParamMap;
    for (const { param, label } of OAUTH_RESULT_PARAMS) {
      const result = params.get(param);
      if (!result) continue;
      // Teams vuelve con un código para elegir los canales (?teamsAccount=pick&pick=…).
      if (result === 'pick') {
        this.teamsPick.set(params.get('pick'));
        void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
        continue;
      }
      if (result === 'connected') this.toast.success(`${label}: conexión completada.`);
      else if (result === 'reconnected') this.toast.success(`${label}: reconexión completada; lo que esperaba continúa.`);
      else this.toast.error(OAUTH_CONNECT_REASON[params.get('reason') ?? ''] ?? `No se pudo conectar: ${label}.`);
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
  }
}

