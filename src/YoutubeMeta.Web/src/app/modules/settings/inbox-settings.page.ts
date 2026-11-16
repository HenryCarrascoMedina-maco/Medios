import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime, firstValueFrom, merge } from 'rxjs';
import { INBOX_MODE_META, PLATFORM_META } from '@core/constants/status.constants';
import { InboxHttp } from '@core/http/api.http';
import { IInboxAccount } from '@core/models/api.models';
import { EntityHubService } from '@core/services/entity-hub.service';
import { ToastService } from '@core/services/toast.service';
import { apiError, formatAgo } from '@core/utils/format';
import { createLoader } from '@core/utils/loader';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { ChipComponent } from '@shared/ui/chip.component';
import { IconComponent } from '@shared/ui/icon.component';
import { SettingsTabsComponent } from './settings-tabs.component';
import { copyText } from '@core/utils/clipboard';

/** Cómo se arregla lo que le falta a una cuenta: a dónde lleva el botón. */
const FIX_LINK = {
  RECONNECT: { label: 'Volver a conectar', path: '/connections' },
  SETTINGS: { label: 'Abrir Ajustes', path: '/settings' },
  GUIDE: { label: 'Ver la guía', path: null }
} as const;

/**
 * Configuración › Bandeja: qué recibe cada cuenta (privados y comentarios), cómo le llega (al instante o consultando)
 * y, si no puede, por qué y cómo se arregla, y conservación de los mensajes. Las respuestas con /atajo están en Plantillas.
 */
@Component({
  selector: 'ym-inbox-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AccountAvatarComponent, AsyncStateComponent, ChipComponent, IconComponent, SettingsTabsComponent],
  templateUrl: './inbox-settings.page.html'
})
export class InboxSettingsPage implements OnInit {
  private readonly http = inject(InboxHttp);
  private readonly hub = inject(EntityHubService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly meta = PLATFORM_META;
  protected readonly modeMeta = INBOX_MODE_META;
  protected readonly fixLink = FIX_LINK;
  protected readonly formatAgo = formatAgo;

  protected readonly data = createLoader(() => this.http.settings(), {
    errorMessage: 'No se pudo cargar la configuración de la bandeja.'
  });
  protected readonly busy = signal<string | null>(null);

  ngOnInit(): void {
    merge(this.hub.on('Connection'), this.hub.on('Credential'), this.hub.reconnected$)
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.data.reload());
    this.data.reload();
  }

  protected guideOf(account: IInboxAccount): string {
    return PLATFORM_META[account.platform].guide;
  }

  protected async toggle(account: IInboxAccount, field: 'inboxDirect' | 'inboxComments'): Promise<void> {
    this.busy.set(`acc-${account.id}`);
    try {
      const updated = await firstValueFrom(this.http.saveAccount(account.id, {
        inboxDirect: field === 'inboxDirect' ? !account.inboxDirect : account.inboxDirect,
        inboxComments: field === 'inboxComments' ? !account.inboxComments : account.inboxComments
      }));
      this.replaceAccount(updated);
    } catch (error) {
      this.toast.error(apiError(error));
    } finally {
      this.busy.set(null);
    }
  }

  /** Vuelve a suscribir la cuenta a los avisos (Meta, WhatsApp) o a poner el webhook del bot. */
  protected async prepare(account: IInboxAccount): Promise<void> {
    this.busy.set(`prep-${account.id}`);
    try {
      this.replaceAccount(await firstValueFrom(this.http.prepareAccount(account.id)));
      this.toast.success(`${account.name}: lista para recibir.`);
    } catch (error) {
      this.toast.error(apiError(error));
    } finally {
      this.busy.set(null);
    }
  }

  protected copy(text: string | null): Promise<void> {
    return copyText(this.toast, text);
  }

  private replaceAccount(account: IInboxAccount): void {
    this.data.value.update(s => s && { ...s, accounts: s.accounts.map(a => (a.id === account.id ? account : a)) });
  }
}
