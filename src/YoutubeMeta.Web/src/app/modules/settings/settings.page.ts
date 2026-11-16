import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime, firstValueFrom } from 'rxjs';
import { SettingsHttp } from '@core/http/api.http';
import { IClientCredentialSource, ICredential, ICredentialSource, IPlatformSettings } from '@core/models/api.models';
import { ConfirmService } from '@core/services/confirm.service';
import { EntityHubService } from '@core/services/entity-hub.service';
import { RulesService } from '@core/services/rules.service';
import { ToastService } from '@core/services/toast.service';
import { apiError } from '@core/utils/format';
import { createLoader } from '@core/utils/loader';
import { TELEGRAM_CLOUD_MAX_MB } from '@core/utils/publication-rules';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { IconComponent } from '@shared/ui/icon.component';
import { CLIENT_PLATFORM, ClientCardComponent, ClientPlatform, IClientCardText, IClientForm } from './client-card.component';
import { SettingsTabsComponent } from './settings-tabs.component';
import { ReqComponent } from '@shared/ui/req.component';
import { copyText } from '@core/utils/clipboard';

/** Cada cliente OAuth de Ajustes: de dónde sale su estado, sus textos y el aviso al guardarlo. */
interface IClientConfig {
  platform: ClientPlatform;
  source: 'google' | 'tiktok' | 'linkedin' | 'linkedinOrg' | 'teams' | 'metaApp';
  text: IClientCardText;
  saved: string;
}

const CLIENTS: readonly IClientConfig[] = [
  {
    platform: 'YOUTUBE', source: 'google', saved: 'Cliente de Google guardado.',
    text: { title: 'Google · YouTube', idLabel: 'ID de cliente', idHint: 'Termina en .apps.googleusercontent.com', secretHint: 'Empieza por GOCSPX-', step: 'cliente' }
  },
  {
    platform: 'TIKTOK', source: 'tiktok', saved: 'App de TikTok guardada.',
    text: { title: 'TikTok', idLabel: 'Client key', idHint: 'En TikTok for Developers › tu app › Credentials', secretHint: 'Client secret de la misma pantalla', step: 'claves' }
  },
  {
    platform: 'LINKEDIN', source: 'linkedin', saved: 'App de LinkedIn (perfil) guardada.',
    text: { title: 'LinkedIn · perfil personal', idLabel: 'Client ID', idHint: 'En LinkedIn Developers › tu app › Auth', secretHint: 'Primary Client Secret de la misma pantalla', step: 'claves' }
  },
  {
    platform: 'LINKEDIN_ORG', source: 'linkedinOrg', saved: 'App de LinkedIn (páginas de empresa) guardada.',
    text: { title: 'LinkedIn · páginas de empresa', idLabel: 'Client ID', idHint: 'De la app con Community Management API (otra app)', secretHint: 'Primary Client Secret de esa app', step: 'empresa-claves' }
  },
  {
    platform: 'TEAMS', source: 'teams', saved: 'App de Microsoft Teams guardada.',
    text: {
      title: 'Microsoft Teams', idLabel: 'Id. de aplicación (cliente)', idHint: 'En Microsoft Entra › Registros de aplicaciones › tu app',
      secretHint: 'El VALOR del secreto (no su Id.)', step: 'ids', tenantLabel: 'Id. de directorio (inquilino)', tenantHint: 'en la misma página de la app', secretExpiry: true
    }
  },
  {
    platform: 'META', source: 'metaApp', saved: 'App de Meta guardada: ya puedes configurar el webhook.',
    text: {
      title: 'App de Meta (bandeja)', idLabel: 'Identificador de la app (App ID)', idHint: 'Configuración de la app › Básica',
      secretHint: 'Clave secreta de la app (Mostrar)', step: 'app-meta', guide: 'whatsapp'
    }
  }
];

const emptyForms = (): Record<ClientPlatform, IClientForm> =>
  Object.fromEntries(CLIENTS.map(c => [c.platform, { publicId: '', secret: '' }])) as Record<ClientPlatform, IClientForm>;

/**
 * Ajustes › Plataformas: claves que la app necesita para conectar cuentas. Se guardan cifradas en la
 * base y tienen prioridad sobre user-secrets / variables de IIS (que siguen valiendo como respaldo).
 */
@Component({
  selector: 'ym-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, FormsModule, NgTemplateOutlet, RouterLink, AccountAvatarComponent, AsyncStateComponent, IconComponent, ClientCardComponent,
    ReqComponent, SettingsTabsComponent
  ],
  templateUrl: './settings.page.html'
})
export class SettingsPage implements OnInit {
  private readonly http = inject(SettingsHttp);
  private readonly rules = inject(RulesService);
  private readonly hub = inject(EntityHubService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly settings = createLoader(() => this.http.platforms(), { errorMessage: 'No se pudieron cargar los ajustes.' });
  protected readonly busy = signal<string | null>(null);
  protected readonly forms = signal<Record<ClientPlatform, IClientForm>>(emptyForms());
  protected readonly botToken = signal('');
  protected readonly botBaseUrl = signal('');
  protected readonly botMaxMb = signal<number | null>(null);
  protected readonly editingBot = signal<ICredential | null>(null);
  protected readonly botFormOpen = signal(false);

  /** Solo las claves de plataformas activas (LinkedIn desactivado no muestra sus apps). */
  protected readonly clients = computed(() => CLIENTS.filter(c => this.rules.isEnabled(CLIENT_PLATFORM[c.platform])));
  protected readonly telegramEnabled = computed(() => this.rules.isEnabled('TELEGRAM'));
  protected readonly telegramMaxMb = TELEGRAM_CLOUD_MAX_MB;

  constructor() {
    // El ID público guardado rellena el formulario si el usuario aún no escribió otro.
    effect(() => {
      const settings = this.settings.value();
      if (!settings) return;
      untracked(() => this.forms.update(forms => {
        const next = { ...forms };
        for (const c of CLIENTS) {
          const form = forms[c.platform];
          const src = this.sourceOf(settings, c);
          next[c.platform] = {
            ...form,
            publicId: form.publicId || src?.publicId || '',
            ...(c.text.tenantLabel ? { tenantId: form.tenantId || src?.tenantId || '' } : {}),
            ...(c.text.secretExpiry ? { secretExpiresAt: form.secretExpiresAt || src?.secretExpiresAt?.slice(0, 10) || '' } : {})
          };
        }
        return next;
      }));
    });
  }

  ngOnInit(): void {
    this.hub.on('Credential').pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.settings.reload());
    this.settings.reload();
  }

  /** Estado guardado de un cliente (una API antigua puede no traer los de LinkedIn). */
  protected sourceOf(settings: IPlatformSettings, client: IClientConfig): IClientCredentialSource | null {
    return settings[client.source] ?? null;
  }

  protected patchClient(platform: ClientPlatform, changes: Partial<IClientForm>): void {
    this.forms.update(forms => ({ ...forms, [platform]: { ...forms[platform], ...changes } }));
  }

  protected async saveClient(client: IClientConfig): Promise<void> {
    const platform = client.platform;
    const form = this.forms()[platform];
    this.busy.set(platform);
    try {
      const teams = client.text.tenantLabel ? { tenantId: form.tenantId?.trim() || null, secretExpiresAt: form.secretExpiresAt || null } : {};
      await firstValueFrom(this.http.save({ platform, publicId: form.publicId.trim(), secret: form.secret.trim() || null, ...teams }));
      this.toast.success(client.saved);
      this.patchClient(platform, { secret: '' });
      this.settings.reload();
    } catch (error) {
      this.toast.error(apiError(error));
    } finally {
      this.busy.set(null);
    }
  }

  /** Borra la clave guardada aquí: se vuelve a usar la de user-secrets / IIS si existe. */
  protected async deleteClient(source: ICredentialSource, label: string): Promise<void> {
    if (!source.credentialId) return;
    const accepted = await this.confirm.ask({
      title: `Borrar ${label}`,
      message: 'Se usará la clave de user-secrets o IIS si existe. Las cuentas conectadas con este cliente tendrán que reconectarse si el cliente cambia.',
      confirmText: 'Borrar',
      danger: true
    });
    if (accepted) await this.remove(source.credentialId);
  }

  protected startBot(bot: ICredential | null, open = true): void {
    this.botFormOpen.set(open);
    this.editingBot.set(bot);
    this.botToken.set('');
    this.botBaseUrl.set(bot?.options.apiBaseUrl ?? '');
    this.botMaxMb.set(bot?.options.maxUploadMb ?? null);
  }

  protected async saveBot(): Promise<void> {
    const editing = this.editingBot();
    this.busy.set('bot');
    try {
      await firstValueFrom(this.http.save({
        id: editing?.id ?? null,
        platform: 'TELEGRAM',
        secret: this.botToken().trim() || null,
        apiBaseUrl: this.botBaseUrl().trim() || null,
        maxUploadMb: this.botMaxMb()
      }));
      this.toast.success('Bot guardado y comprobado con Telegram.');
      this.startBot(null, false);
      this.settings.reload();
    } catch (error) {
      this.toast.error(apiError(error));
    } finally {
      this.busy.set(null);
    }
  }

  protected async deleteBot(bot: ICredential): Promise<void> {
    const accepted = await this.confirm.ask({ title: `Borrar ${bot.name}`, message: 'Se borra el token guardado. Telegram no cambia: el bot sigue existiendo en @BotFather.', confirmText: 'Borrar', danger: true });
    if (accepted) await this.remove(bot.id);
  }

  protected copy(text: string | null): Promise<void> {
    return copyText(this.toast, text);
  }

  private async remove(id: number): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(id));
      this.toast.success('Clave borrada.');
      this.settings.reload();
    } catch (error) {
      this.toast.error(apiError(error));
    }
  }
}
