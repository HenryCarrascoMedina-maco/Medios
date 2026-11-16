import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PLATFORM_META } from '@core/constants/status.constants';
import { InboxHttp } from '@core/http/api.http';
import { IInboxAccount, IInboxContact, IInboxInvite, Platform } from '@core/models/api.models';
import { ToastService } from '@core/services/toast.service';
import { apiError } from '@core/utils/format';
import { DIRECT_PLATFORMS, emailShareUrl, inviteMessage, whatsAppShareUrl } from '@core/utils/inbox';
import { IconComponent } from '@shared/ui/icon.component';
import { ModalComponent } from '@shared/ui/modal.component';
import { PlatformBadgeComponent } from '@shared/ui/platform-badge.component';
import { ITemplateChoice, TemplatePickerComponent } from './template-picker.component';
import { copyText } from '@core/utils/clipboard';

/**
 * «Nueva conversación»: escribir primero a alguien. WhatsApp deja hacerlo por número con una plantilla aprobada;
 * Telegram, Messenger e Instagram no dejan escribir primero, así que se crea un enlace de invitación para la persona.
 * Cuando abre el chat con él, su cuenta en esa red queda vinculada a su ficha.
 */
@Component({
  selector: 'ym-new-conversation-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, RouterLink, IconComponent, ModalComponent, PlatformBadgeComponent, TemplatePickerComponent],
  template: `
    <ym-modal title="Nueva conversación" [width]="620" (closed)="closed.emit()">
      @if (accounts() === null) {
        <p class="text-sm muted">Cargando cuentas…</p>
      } @else if (!platforms().length) {
        <div class="notice notice-warn">
          No hay ninguna cuenta de WhatsApp, Telegram, Facebook o Instagram que reciba mensajes privados.
          Conéctala en <a routerLink="/connections" (click)="closed.emit()">Conexiones</a> y actívala en
          <a routerLink="/settings/inbox" (click)="closed.emit()">Configuración › Bandeja</a>.
        </div>
      } @else {
        <div class="flex flex-wrap gap-1.5" role="tablist" aria-label="Red">
          @for (p of platforms(); track p) {
            <button type="button" role="tab" class="btn btn-sm" [class.btn-primary]="platform() === p" [attr.aria-selected]="platform() === p" (click)="selectPlatform(p)">
              <ym-platform-badge [platform]="p" [size]="13" />
            </button>
          }
        </div>

        @if (platformAccounts().length > 1) {
          <div>
            <label class="label" for="nc-account">{{ isWhatsApp() ? 'Desde el número' : 'Cuenta' }}</label>
            <select id="nc-account" class="input" [ngModel]="accountId()" (ngModelChange)="selectAccount($event)">
              @for (a of platformAccounts(); track a.id) { <option [ngValue]="a.id">{{ a.name }}@if (a.accountHint) { · {{ a.accountHint }} }</option> }
            </select>
          </div>
        }

        <!-- A quién: un contacto existente o uno nuevo de la agenda. -->
        <section class="grid gap-2">
          <span class="label">{{ isWhatsApp() ? 'Contacto (opcional)' : 'Contacto' }}</span>
          @if (contact(); as c) {
            <div class="flex items-center gap-2 rounded-lg border border-line p-2 text-sm">
              <ym-platform-badge [platform]="c.platform" [showLabel]="false" [size]="14" />
              <span class="min-w-0 flex-1 truncate"><b>{{ c.displayName }}</b>
                @if (c.phone ?? c.handle; as h) { <span class="muted"> · {{ h }}</span> }
                @if (c.email) { <span class="muted"> · {{ c.email }}</span> }
              </span>
              <button type="button" class="btn btn-ghost btn-sm" (click)="clearContact()">Cambiar</button>
            </div>
          } @else if (creating()) {
            <div class="grid gap-2 rounded-lg border border-line p-3">
              <input class="input" placeholder="Nombre" aria-label="Nombre" [ngModel]="newName()" (ngModelChange)="newName.set($event)" />
              <input class="input" placeholder="Teléfono con código de país: +51 987 654 321" aria-label="Teléfono" inputmode="tel" [ngModel]="newPhone()" (ngModelChange)="newPhone.set($event)" />
              <input class="input" placeholder="Correo (para mandarle la invitación)" aria-label="Correo" type="email" [ngModel]="newEmail()" (ngModelChange)="newEmail.set($event)" />
              <div class="flex justify-end gap-2">
                <button type="button" class="btn btn-sm" (click)="creating.set(false)">Cancelar</button>
                <button type="button" class="btn btn-sm btn-primary" [disabled]="!newName().trim() || busy()" (click)="createContact()">Guardar en la agenda</button>
              </div>
            </div>
          } @else {
            <input type="search" class="input" placeholder="Buscar por nombre, teléfono o correo…" aria-label="Buscar contacto" [ngModel]="search()" (ngModelChange)="find($event)" />
            @for (r of results(); track r.id) {
              <button type="button" class="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-surface-hover" (click)="pickContact(r)">
                <ym-platform-badge [platform]="r.platform" [showLabel]="false" [size]="14" />
                <span class="min-w-0 flex-1 truncate">{{ r.displayName }} @if (r.phone ?? r.handle; as h) { <span class="muted">{{ h }}</span> }</span>
              </button>
            }
            <button type="button" class="btn btn-sm justify-self-start" (click)="startCreating()"><ym-icon name="plus" [size]="12" /> Nuevo contacto</button>
          }
        </section>

        @if (isWhatsApp()) {
          <section class="grid gap-2">
            <div class="grid gap-2 sm:grid-cols-2">
              <div>
                <label class="label" for="nc-phone">Teléfono</label>
                <input id="nc-phone" class="input" inputmode="tel" placeholder="+51 987 654 321" [ngModel]="phone()" (ngModelChange)="phone.set($event)" />
              </div>
              <div>
                <label class="label" for="nc-name">Nombre en la bandeja</label>
                <input id="nc-name" class="input" [placeholder]="contact()?.displayName ?? 'Opcional'" [ngModel]="name()" (ngModelChange)="name.set($event)" />
              </div>
            </div>
            @if (accountId(); as id) {
              <ym-template-picker [connectionId]="id" (choice)="template.set($event)" />
            }
            <label class="flex items-start gap-2 text-sm">
              <input type="checkbox" class="mt-1" [checked]="consent()" (change)="consent.set(!consent())" />
              <span>La persona aceptó recibir mensajes de WhatsApp de nosotros. <span class="muted">Meta lo exige; sin él puede bloquear el número.</span></span>
            </label>
            <p class="notice notice-info">WhatsApp solo deja empezar con una plantilla aprobada. Cuando la persona responda podrás escribirle libremente durante 24 h.</p>
          </section>
        } @else {
          <p class="notice notice-warn">{{ inviteHelp() }}</p>
          @if (invite(); as i) {
            <section class="grid gap-2 rounded-lg border border-line p-3">
              <label class="label" for="nc-link">Enlace de invitación <small>vale hasta el {{ i.expiresAt | date: 'dd/MM/yyyy' }} · un solo uso</small></label>
              <input id="nc-link" class="input font-mono text-xs" readonly [value]="i.link" (focus)="$any($event.target).select()" />
              <div class="flex flex-wrap gap-2">
                <button type="button" class="btn btn-sm" (click)="copy(i.link)"><ym-icon name="paperclip" [size]="12" /> Copiar enlace</button>
                <a class="btn btn-sm btn-whatsapp no-underline" target="_blank" rel="noopener" [href]="shareWhatsApp(i)"><ym-icon name="whatsapp" [size]="12" /> Enviar por WhatsApp</a>
                @if (contact()?.email; as email) {
                  <a class="btn btn-sm no-underline" [href]="shareEmail(i, email)"><ym-icon name="send" [size]="12" /> Enviar por correo</a>
                }
              </div>
              <p class="text-xs muted">Cuando {{ contact()?.displayName }} abra el chat con el enlace, la conversación aparecerá en la bandeja ya asociada a su ficha.</p>
            </section>
          }
        }
      }

      <ng-container modal-footer>
        <button type="button" class="btn" (click)="closed.emit()">{{ invite() ? 'Cerrar' : 'Cancelar' }}</button>
        @if (isWhatsApp()) {
          <button type="button" class="btn btn-primary" [disabled]="!canStart() || busy()" (click)="start()"><ym-icon name="send" [size]="13" /> {{ busy() ? 'Enviando…' : 'Enviar plantilla' }}</button>
        } @else if (platforms().length && !invite()) {
          <button type="button" class="btn btn-primary" [disabled]="!contact() || !accountId() || busy()" (click)="createInvite()"><ym-icon name="link" [size]="13" /> Crear enlace</button>
        }
      </ng-container>
    </ym-modal>
  `
})
export class NewConversationDialog implements OnInit {
  private readonly http = inject(InboxHttp);
  private readonly toast = inject(ToastService);

  /** Persona ya elegida (desde su ficha) y red con la que abrir. */
  readonly initialContact = input<IInboxContact | null>(null);
  readonly initialPlatform = input<Platform | null>(null);
  /** Conversación de WhatsApp creada: la página la abre. */
  readonly started = output<number>();
  readonly closed = output<void>();

  protected readonly accounts = signal<IInboxAccount[] | null>(null);
  protected readonly platform = signal<Platform>('WHATSAPP');
  protected readonly accountId = signal<number | null>(null);
  protected readonly contact = signal<IInboxContact | null>(null);
  protected readonly busy = signal(false);

  protected readonly search = signal('');
  protected readonly results = signal<IInboxContact[]>([]);
  protected readonly creating = signal(false);
  protected readonly newName = signal('');
  protected readonly newPhone = signal('');
  protected readonly newEmail = signal('');

  protected readonly phone = signal('');
  protected readonly name = signal('');
  protected readonly template = signal<ITemplateChoice | null>(null);
  protected readonly consent = signal(false);
  protected readonly invite = signal<IInboxInvite | null>(null);

  /** Cuentas que reciben privados, por red (en el orden de DIRECT_PLATFORMS). */
  private readonly usable = computed(() =>
    (this.accounts() ?? []).filter(a => DIRECT_PLATFORMS.includes(a.platform) && a.statusCode === 'CONNECTED' && a.supportsDirect && a.inboxDirect));
  protected readonly platforms = computed(() => DIRECT_PLATFORMS.filter(p => this.usable().some(a => a.platform === p)));
  protected readonly platformAccounts = computed(() => this.usable().filter(a => a.platform === this.platform()));
  protected readonly isWhatsApp = computed(() => this.platform() === 'WHATSAPP');
  protected readonly canStart = computed(() => !!this.accountId() && this.phone().trim().length > 0 && !!this.template()?.complete && this.consent());
  protected readonly inviteHelp = computed(() => {
    const label = PLATFORM_META[this.platform()].label;
    return this.platform() === 'INSTAGRAM'
      ? 'Instagram no deja escribir primero a nadie. Mándale este enlace: al abrirlo verá el chat con tu cuenta. Si Instagram no avisa de la invitación, el chat llega igual y lo vinculas a su ficha con «Vincular».'
      : `${label} no deja escribir primero a nadie, ni por número ni por nombre. Mándale este enlace: cuando lo abra y pulse «Iniciar», podrás responderle desde la bandeja.`;
  });

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    const contact = this.initialContact();
    if (contact) this.pickContact(contact);
    try {
      this.accounts.set((await firstValueFrom(this.http.settings())).accounts);
    } catch (error) {
      this.accounts.set([]);
      this.toast.error(apiError(error));
    }
    const wanted = this.initialPlatform();
    this.selectPlatform(wanted && this.platforms().includes(wanted) ? wanted : this.platforms()[0] ?? 'WHATSAPP');
  }

  protected selectPlatform(platform: Platform): void {
    this.platform.set(platform);
    this.selectAccount(this.platformAccounts()[0]?.id ?? null);
  }

  protected selectAccount(id: number | null): void {
    this.accountId.set(id);
    this.template.set(null);
    this.invite.set(null);
  }

  protected find(term: string): void {
    this.search.set(term);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (term.trim().length < 2) {
      this.results.set([]);
      return;
    }
    this.searchTimer = setTimeout(async () => this.results.set(await firstValueFrom(this.http.searchContacts(term.trim())).catch(() => [])), 300);
  }

  protected pickContact(contact: IInboxContact): void {
    this.contact.set(contact);
    this.results.set([]);
    this.search.set('');
    this.invite.set(null);
    // El número sale de la agenda o, si ya escribió por WhatsApp, de su cuenta ahí.
    const phone = contact.phone ?? (contact.platform === 'WHATSAPP' ? contact.handle : null);
    if (phone) this.phone.set(phone);
  }

  protected clearContact(): void {
    this.contact.set(null);
    this.invite.set(null);
  }

  protected startCreating(): void {
    this.newName.set(this.search().trim());
    this.newPhone.set('');
    this.newEmail.set('');
    this.creating.set(true);
  }

  protected async createContact(): Promise<void> {
    this.busy.set(true);
    try {
      const detail = await firstValueFrom(this.http.createContact({ displayName: this.newName().trim(), phone: this.newPhone().trim() || null, email: this.newEmail().trim() || null }));
      this.creating.set(false);
      this.pickContact(detail.contact);
      this.toast.success(`${detail.contact.displayName} guardado en la agenda.`);
    } catch (error) {
      this.toast.error(apiError(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async start(): Promise<void> {
    const template = this.template();
    const accountId = this.accountId();
    if (!this.canStart() || !template || !accountId) return;
    this.busy.set(true);
    try {
      const conversation = await firstValueFrom(this.http.startConversation({
        connectionId: accountId,
        contactId: this.contact()?.id ?? null,
        phone: this.phone().trim(),
        displayName: this.name().trim() || null,
        templateName: template.name,
        templateLanguage: template.language,
        templateParams: template.params,
        consent: this.consent()
      }));
      this.toast.success('Plantilla en cola. La conversación ya está en la bandeja.');
      this.started.emit(conversation.id);
    } catch (error) {
      this.toast.error(apiError(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async createInvite(): Promise<void> {
    const contact = this.contact();
    const accountId = this.accountId();
    if (!contact || !accountId) return;
    this.busy.set(true);
    try {
      this.invite.set(await firstValueFrom(this.http.createInvite(accountId, contact.id)));
    } catch (error) {
      this.toast.error(apiError(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected shareWhatsApp(invite: IInboxInvite): string {
    const contact = this.contact();
    return whatsAppShareUrl(contact?.phone, inviteMessage(contact?.displayName ?? '', PLATFORM_META[invite.platform].label, invite.link));
  }

  protected shareEmail(invite: IInboxInvite, email: string): string {
    const network = PLATFORM_META[invite.platform].label;
    return emailShareUrl(email, `Escríbenos por ${network}`, inviteMessage(this.contact()?.displayName ?? '', network, invite.link));
  }

  protected copy(text: string): Promise<void> {
    return copyText(this.toast, text, 'Enlace copiado.');
  }
}
