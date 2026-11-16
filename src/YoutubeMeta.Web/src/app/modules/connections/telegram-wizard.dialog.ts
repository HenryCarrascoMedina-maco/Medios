import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ConnectionHttp, SettingsHttp } from '@core/http/api.http';
import { IConnection, ICredential, ITelegramChat } from '@core/models/api.models';
import { ToastService } from '@core/services/toast.service';
import { apiError } from '@core/utils/format';
import { TELEGRAM_CLOUD_MAX_MB } from '@core/utils/publication-rules';
import { IconComponent } from '@shared/ui/icon.component';
import { ModalComponent } from '@shared/ui/modal.component';
import { ReqComponent } from '@shared/ui/req.component';

/** Asistente de Telegram: 1) bot (elegido o nuevo) → 2) canal detectado o escrito a mano. */
@Component({
  selector: 'ym-telegram-wizard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ModalComponent, IconComponent, ReqComponent],
  template: `
    <ym-modal title="Conectar canal de Telegram" [width]="640" (closed)="closed.emit()">
      <ym-icon modal-icon name="telegram" [size]="20" class="text-telegram" />

      <div>
        <div class="label">1. Bot que publicará <ym-req /> <small>un bot sirve para todos tus canales</small></div>
        @if (bots().length) {
          <select class="input" aria-label="Bot" (change)="selectBot($any($event.target).value)">
            @for (b of bots(); track b.id) { <option [value]="b.id" [selected]="b.id === botId()">{{ b.name }} · hasta {{ b.options.maxUploadMb ?? defaultMaxMb }} MB</option> }
          </select>
        }
        <details class="mt-2 text-sm" [open]="bots().length === 0">
          <summary class="flex cursor-pointer items-center gap-1 text-xs font-semibold"><ym-icon name="plus" [size]="12" /> Añadir un bot nuevo</summary>
          <div class="mt-2 flex gap-2">
            <input class="input font-mono text-xs" [value]="newBotToken()" (input)="newBotToken.set($any($event.target).value)" aria-label="Token del bot"
                   placeholder="123456789:AA… (token de @BotFather)" autocomplete="off" spellcheck="false" />
            <button type="button" class="btn btn-telegram btn-sm" [disabled]="newBotToken().trim().length < 20 || busy() !== null" (click)="addBot()">{{ busy() === 'bot' ? 'Guardando…' : 'Guardar bot' }}</button>
          </div>
          <p class="hint">En Telegram abre <b>&#64;BotFather</b>, envía <code>/newbot</code> y copia el token. <a routerLink="/guides/telegram" (click)="closed.emit()">Guía paso a paso</a>.</p>
        </details>
      </div>

      @if (botId()) {
        <div>
          <label class="label" for="tg-chat">2. Canal <ym-req /> <small>el bot debe ser administrador con «Publicar mensajes»</small></label>
          <div class="flex flex-wrap gap-2">
            <input id="tg-chat" class="input flex-1" [value]="chatInput()" (input)="chatInput.set($any($event.target).value)" placeholder="@micanal, t.me/micanal o -100…" (keydown.enter)="save()" />
            <button type="button" class="btn btn-telegram btn-sm" [disabled]="!chatInput().trim() || busy() !== null" (click)="save()">{{ busy() === 'save' ? 'Comprobando…' : 'Conectar' }}</button>
          </div>
          <button type="button" class="btn btn-sm mt-2" [disabled]="busy() !== null" (click)="detectChats()">
            <ym-icon name="search" [size]="13" /> {{ busy() === 'chats' ? 'Buscando…' : 'Buscar canales donde añadí el bot (últimas 24 h)' }}
          </button>
          @if (chats(); as list) {
            <div class="mt-2 grid gap-2">
              @for (c of list; track c.id) {
                <div class="choice">
                  <span class="min-w-0 flex-1">
                    <b class="block truncate">{{ c.title }}</b>
                    <span class="block text-xs muted">{{ c.username ? '@' + c.username : 'privado · ' + c.id }} · {{ c.type }}@if (c.alreadyConnected) { · ya conectado }</span>
                    @if (c.problem) { <span class="block text-xs text-red-500">{{ c.problem }}</span> }
                  </span>
                  <button type="button" class="btn btn-sm" [disabled]="!c.canPost || busy() !== null" (click)="save(c.id)">Conectar</button>
                </div>
              } @empty {
                <p class="text-xs muted">No aparece ninguno. Añade el bot como administrador del canal (o publica algo en el canal) y vuelve a buscar, o escribe el &#64;usuario arriba.</p>
              }
            </div>
          }
        </div>
      }

      <ng-container modal-footer>
        <button type="button" class="btn" (click)="closed.emit()">Cerrar</button>
      </ng-container>
    </ym-modal>
  `
})
export class TelegramWizardDialog implements OnInit {
  private readonly http = inject(ConnectionHttp);
  private readonly settingsHttp = inject(SettingsHttp);
  private readonly toast = inject(ToastService);

  /** Al reconectar: el canal y el bot de esa cuenta vienen elegidos. */
  readonly account = input<IConnection | null>(null);
  readonly closed = output<void>();
  readonly connected = output<void>();

  protected readonly defaultMaxMb = TELEGRAM_CLOUD_MAX_MB;
  protected readonly bots = signal<ICredential[]>([]);
  protected readonly botId = signal<number | null>(null);
  protected readonly newBotToken = signal('');
  protected readonly chats = signal<ITelegramChat[] | null>(null);
  protected readonly chatInput = signal('');
  protected readonly busy = signal<'bot' | 'chats' | 'save' | null>(null);

  ngOnInit(): void {
    const account = this.account();
    this.chatInput.set(account ? (account.accountHint?.startsWith('@') ? account.accountHint : account.externalId) : '');
    void this.loadBots(account?.credentialId ?? null);
  }

  protected selectBot(value: string): void {
    this.botId.set(Number(value));
    this.chats.set(null);
  }

  protected async addBot(): Promise<void> {
    await this.run('bot', async () => {
      const id = await firstValueFrom(this.settingsHttp.save({ platform: 'TELEGRAM', secret: this.newBotToken().trim() }));
      this.newBotToken.set('');
      this.toast.success('Bot guardado. Ahora añádelo como administrador de tu canal.');
      await this.loadBots(id);
    }, 'No se pudo guardar el bot.');
  }

  protected async detectChats(): Promise<void> {
    const botId = this.botId();
    if (!botId) return;
    await this.run('chats', async () => this.chats.set(await firstValueFrom(this.http.telegramChats(botId))), 'No se pudieron leer los canales del bot.');
  }

  protected async save(chat?: string): Promise<void> {
    const botId = this.botId();
    const value = chat ?? this.chatInput().trim();
    if (!botId || !value || this.busy()) return;
    await this.run('save', async () => {
      const result = await firstValueFrom(this.http.telegramSave(botId, value));
      this.toast.success(`Canal «${result.name}» ${result.isNew ? 'conectado' : 'reconectado'}.`);
      this.connected.emit();
      this.closed.emit();
    }, 'No se pudo conectar el canal.');
  }

  private async loadBots(select: number | null): Promise<void> {
    try {
      const settings = await firstValueFrom(this.settingsHttp.platforms());
      this.bots.set(settings.telegramBots);
      this.botId.set(select ?? settings.telegramBots[0]?.id ?? null);
    } catch (error) {
      this.toast.error(apiError(error));
    }
  }

  private async run(kind: 'bot' | 'chats' | 'save', action: () => Promise<void>, fallback: string): Promise<void> {
    this.busy.set(kind);
    try {
      await action();
    } catch (error) {
      this.toast.error(apiError(error, fallback));
    } finally {
      this.busy.set(null);
    }
  }
}
