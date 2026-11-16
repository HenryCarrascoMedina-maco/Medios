import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PLATFORM_META } from '@core/constants/status.constants';
import { InboxHttp } from '@core/http/api.http';
import { IInboxContact, IInboxContactDetail, IInboxConversation, Platform } from '@core/models/api.models';
import { DIRECT_PLATFORMS } from '@core/utils/inbox';
import { ToastService } from '@core/services/toast.service';
import { apiError, formatAgo } from '@core/utils/format';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { IconComponent } from '@shared/ui/icon.component';
import { PlatformBadgeComponent } from '@shared/ui/platform-badge.component';
import { TagEditorComponent } from '@shared/ui/tag-editor.component';
import { InboxStore } from './inbox.store';
import { NewConversationDialog } from './new-conversation.dialog';

/**
 * Ficha de la derecha: la persona (y la misma persona en otras redes, vinculada a mano), las etiquetas de la
 * conversación y de qué publicación viene.
 */
@Component({
  selector: 'ym-contact-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, RouterLink, AccountAvatarComponent, IconComponent, NewConversationDialog, PlatformBadgeComponent, TagEditorComponent],
  host: { class: 'block overflow-y-auto border-l border-line bg-surface p-3 text-sm' },
  template: `
    @let c = conversation();
    @if (c.kind === 'DIRECT') {
      <section class="mb-4">
        <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide muted">Contacto</h3>
        <div class="flex items-center gap-2">
          <ym-account-avatar [platform]="c.platform" [name]="c.contactName ?? ''" [url]="c.contactAvatarUrl" [size]="40" />
          <div class="min-w-0">
            <b class="block truncate">{{ c.contactName ?? c.title }}</b>
            @if (c.contactHandle) { <span class="block truncate text-xs muted">{{ c.contactHandle }}</span> }
          </div>
        </div>
      </section>

      <section class="mb-4">
        <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide muted">También en</h3>
        @for (l of detail()?.linked ?? []; track l.id) {
          <div class="mb-1 flex items-center gap-2 text-xs">
            <ym-platform-badge [platform]="l.platform" [showLabel]="false" [size]="14" />
            @if (l.lastConversationId) { <a class="min-w-0 flex-1 truncate" [routerLink]="['/inbox', l.lastConversationId]">{{ l.displayName }}</a> }
            @else { <span class="min-w-0 flex-1 truncate">{{ l.displayName }}</span> }
            <span class="muted">{{ l.conversations }} conv.</span>
          </div>
        } @empty {
          <p class="text-xs muted">No vinculado con otras redes.</p>
        }
        @if (detail()?.linked?.length) {
          <button type="button" class="mt-1 text-xs text-red-600 hover:underline dark:text-red-400" (click)="unlink()">Desvincular de las demás</button>
        }
        <label class="mt-2 block">
          <span class="sr-only">Buscar a la misma persona en otra red</span>
          <input type="search" class="input py-1 text-xs" placeholder="Vincular: buscar en otra red…" [ngModel]="search()" (ngModelChange)="find($event)" />
        </label>
        @for (r of results(); track r.id) {
          <button type="button" class="mt-1 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs hover:bg-surface-hover" (click)="link(r)">
            <ym-platform-badge [platform]="r.platform" [showLabel]="false" [size]="14" />
            <span class="min-w-0 flex-1 truncate">{{ r.displayName }} @if (r.handle) { <span class="muted">{{ r.handle }}</span> }</span>
            <ym-icon name="link" [size]="12" />
          </button>
        }
        <p class="mt-1 text-[11px] muted">Las redes no dicen si dos cuentas son la misma persona: se vincula a mano y se puede deshacer.</p>
        @if (agenda(); as a) {
          @if (a.phone || a.email) {
            <p class="mt-2 text-xs">
              <ym-icon name="user" [size]="11" /> Agenda:
              @if (a.phone) { <span>{{ a.phone }}</span> } @if (a.phone && a.email) { · } @if (a.email) { <span>{{ a.email }}</span> }
            </p>
          }
        }
        <button type="button" class="btn btn-sm mt-2 w-full" (click)="inviteOpen.set(true)"><ym-icon name="link" [size]="12" /> Escribir o invitar por otra red</button>
      </section>

      @if (detail()?.invites?.length) {
        <section class="mb-4">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide muted">Invitaciones</h3>
          @for (i of detail()!.invites!; track i.id) {
            <div class="mb-1 flex items-center gap-2 text-xs">
              <ym-platform-badge [platform]="i.platform" [showLabel]="false" [size]="14" />
              <span class="min-w-0 flex-1 truncate">{{ i.accountName }}</span>
              @if (i.usedAt) { <span class="text-green-600 dark:text-green-400">abierta {{ i.usedAt | date: 'dd/MM' }}</span> }
              @else if (isExpired(i.expiresAt)) { <span class="muted">caducada</span> }
              @else { <span class="text-amber-600 dark:text-amber-400">pendiente</span> }
            </div>
          }
        </section>
      }

      @if (inviteOpen()) {
        <ym-new-conversation-dialog [initialContact]="agenda() ?? detail()?.contact ?? null" [initialPlatform]="otherPlatform()"
                                    (started)="started($event)" (closed)="inviteOpen.set(false)" />
      }
    } @else {
      <section class="mb-4">
        <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide muted">Publicación</h3>
        <p class="font-semibold">{{ c.title }}</p>
        <p class="text-xs muted">{{ meta().label }} · {{ c.accountName }}</p>
        @if (c.videoId != null) { <a class="mt-1 inline-block text-xs" [routerLink]="['/videos', c.videoId]">Ver en la app</a> }
      </section>
    }

    <section class="mb-4">
      <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide muted">Etiquetas</h3>
      <ym-tag-editor [tags]="c.tags" (tagsChange)="saveTags($event)" placeholder="Añadir etiqueta…" />
    </section>

    <section>
      <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide muted">Historial</h3>
      <ul class="space-y-1 text-xs muted">
        @if (c.lastInboundAt) { <li>Último mensaje recibido: {{ c.lastInboundAt | date: 'dd/MM HH:mm' }}</li> }
        @if (c.awaitingSince) { <li class="text-amber-600 dark:text-amber-400">Esperando respuesta {{ formatAgo(c.awaitingSince) }}</li> }
        @else { <li>Respondida</li> }
        @if (detail()?.contact; as contact) { <li>Contacto desde {{ contact.createdAt | date: 'MMM yyyy' }}</li> }
      </ul>
    </section>
  `
})
export class ContactPanelComponent {
  private readonly http = inject(InboxHttp);
  private readonly toast = inject(ToastService);
  private readonly store = inject(InboxStore);

  readonly conversation = input.required<IInboxConversation>();

  protected readonly meta = computed(() => PLATFORM_META[this.conversation().platform]);
  protected readonly formatAgo = formatAgo;
  protected readonly detail = signal<IInboxContactDetail | null>(null);
  protected readonly search = signal('');
  protected readonly results = signal<IInboxContact[]>([]);
  protected readonly inviteOpen = signal(false);
  /** Ficha de la agenda de esta persona (si la tiene): teléfono y correo para escribirle o invitarle. */
  protected readonly agenda = computed(() => {
    const d = this.detail();
    return d?.contact.platform === 'AGENDA' ? d.contact : d?.linked.find(l => l.platform === 'AGENDA') ?? null;
  });
  /** Para invitar, la primera red en la que aún no está (WhatsApp si no se conoce ninguna). */
  protected readonly otherPlatform = computed<Platform | null>(() => {
    const present = new Set<string>([this.conversation().platform, ...(this.detail()?.linked.map(l => l.platform) ?? [])]);
    return DIRECT_PLATFORMS.find(p => !present.has(p)) ?? null;
  });
  private readonly router = inject(Router);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Solo cambia con otra persona: una actualización de la conversación no borra la búsqueda en curso. */
  private readonly contactId = computed(() => this.conversation().contactId);

  constructor() {
    effect(() => {
      const contactId = this.contactId();
      untracked(() => {
        this.detail.set(null);
        this.search.set('');
        this.results.set([]);
        if (contactId != null) void this.load(contactId);
      });
    });
  }

  protected find(term: string): void {
    this.search.set(term);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const contactId = this.conversation().contactId;
    if (term.trim().length < 2 || contactId == null) {
      this.results.set([]);
      return;
    }
    this.searchTimer = setTimeout(async () => {
      const results = await firstValueFrom(this.http.searchContacts(term.trim(), contactId)).catch(() => []);
      const linked = new Set(this.detail()?.linked.map(l => l.id));
      this.results.set(results.filter(r => !linked.has(r.id)));
    }, 300);
  }

  protected async link(other: IInboxContact): Promise<void> {
    await this.changeLink(other.id, `Vinculado con ${other.displayName}.`);
  }

  protected async unlink(): Promise<void> {
    await this.changeLink(null, 'Desvinculado.');
  }

  protected isExpired(at: string): boolean {
    return Date.parse(at) < Date.now();
  }

  protected started(conversationId: number): void {
    this.inviteOpen.set(false);
    void this.router.navigate(['/inbox', conversationId]);
  }

  protected saveTags(tags: string[]): void {
    void this.store.update(this.conversation().id, { tags });
  }

  private async changeLink(otherId: number | null, success: string): Promise<void> {
    const contactId = this.conversation().contactId;
    if (contactId == null) return;
    try {
      this.detail.set(await firstValueFrom(this.http.linkContact(contactId, otherId)));
      this.search.set('');
      this.results.set([]);
      this.toast.success(success);
    } catch (error) {
      this.toast.error(apiError(error));
    }
  }

  private async load(contactId: number): Promise<void> {
    try {
      const detail = await firstValueFrom(this.http.contact(contactId));
      if (this.conversation().contactId === contactId) this.detail.set(detail);
    } catch {
      // La ficha es secundaria: sin ella la conversación sigue funcionando.
    }
  }
}
