import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { INBOX_KIND_META, INBOX_STATUS_META, PLATFORM_META } from '@core/constants/status.constants';
import { IInboxConversation, IInboxMessage } from '@core/models/api.models';
import { ClockService } from '@core/services/clock.service';
import { conversationName, windowState } from '@core/utils/inbox';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { ChipComponent } from '@shared/ui/chip.component';
import { IconComponent } from '@shared/ui/icon.component';
import { ComposerComponent } from './composer.component';
import { InboxStore } from './inbox.store';
import { MessageBubbleComponent } from './message-bubble.component';

/**
 * Conversación abierta: cabecera (quién, en qué cuenta, ventana de 24 h, estado), historial y compositor. Los comentarios
 * se pintan agrupados por hilo; los privados y grupos, como chat.
 */
@Component({
  selector: 'ym-thread',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AccountAvatarComponent, AsyncStateComponent, ChipComponent, IconComponent, ComposerComponent, MessageBubbleComponent],
  host: { class: 'flex min-h-0 flex-col bg-canvas' },
  template: `
    @let c = conversation();
    @let w = window();
    <header class="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
      <button type="button" class="btn btn-ghost btn-sm btn-icon lg:hidden" aria-label="Volver a la lista" (click)="back.emit()"><ym-icon name="arrowLeft" /></button>
      <ym-account-avatar [platform]="c.platform" [name]="name()" [url]="c.contactAvatarUrl" [size]="32" />
      <div class="min-w-0 flex-1">
        <h2 class="truncate text-sm font-semibold">{{ name() }}</h2>
        <p class="truncate text-xs muted">
          {{ meta().label }} · {{ c.accountName }} · {{ kindMeta[c.kind].label }}
          @if (c.contactHandle && c.kind === 'DIRECT') { · {{ c.contactHandle }} }
        </p>
      </div>
      @if (w) { <ym-chip [tone]="w.tone"><ym-icon name="clock" [size]="11" /> {{ w.label }}</ym-chip> }
      <ym-chip [tone]="statusMeta[c.statusCode].tone">{{ statusMeta[c.statusCode].label }}</ym-chip>
      @if (c.videoId != null) {
        <a class="btn btn-sm no-underline" [routerLink]="['/videos', c.videoId]" title="Ver la publicación en la app"><ym-icon name="film" [size]="13" /> Publicación</a>
      }
      @if (c.link) {
        <a class="btn btn-sm no-underline" [href]="c.link" target="_blank" rel="noopener"><ym-icon name="external" [size]="13" /> Abrir en {{ meta().label }}</a>
      }
      @if (c.statusCode === 'CLOSED') {
        <button type="button" class="btn btn-sm" (click)="store.update(c.id, { statusCode: 'OPEN' })">Reabrir</button>
      } @else {
        @if (c.statusCode === 'OPEN') { <button type="button" class="btn btn-sm" (click)="store.update(c.id, { statusCode: 'PENDING' })">Pendiente</button> }
        <button type="button" class="btn btn-sm" (click)="store.update(c.id, { statusCode: 'CLOSED' })"><ym-icon name="check" [size]="13" /> Cerrar</button>
      }
      <button type="button" class="btn btn-ghost btn-sm btn-icon hidden lg:inline-flex xl:hidden" aria-label="Ficha del contacto" (click)="details.emit()"><ym-icon name="user" /></button>
    </header>

    <div #scroller class="min-h-0 flex-1 overflow-y-auto px-3 py-4">
      <ym-async-state [loader]="store.messages" [isEmpty]="!store.timeline().length" emptyText="Todavía no hay mensajes.">
        @if (store.messages.hasMore()) {
          <div class="mb-3 text-center"><button type="button" class="btn btn-sm" (click)="loadOlder()">Ver mensajes anteriores</button></div>
        }
        @if (isComments()) {
          <div class="grid gap-4">
            @for (t of store.threads(); track t.root.id) {
              <div class="grid gap-2">
                <ym-message-bubble [m]="t.root" [showAuthor]="true" [canReply]="t.root.direction === 'IN' && !!t.root.externalId"
                                   (reply)="replyTo.set($event)" (resolve)="store.resolve(t.root, $event)" />
                @if (t.replies.length) {
                  <div class="ml-6 grid gap-2 border-l-2 border-line pl-3 sm:ml-10">
                    @for (r of t.replies; track r.id) {
                      <ym-message-bubble [m]="r" [showAuthor]="true" [canReply]="r.direction === 'IN' && !!r.externalId"
                                         (reply)="replyTo.set($event)" (resolve)="store.resolve(r, $event)" />
                    }
                  </div>
                }
              </div>
            }
          </div>
        } @else {
          <div class="grid gap-2">
            @for (m of store.timeline(); track m.id) {
              <ym-message-bubble [m]="m" [showAuthor]="c.kind === 'GROUP'" [canReply]="m.direction === 'IN' && !!m.externalId && canQuote()"
                                 (reply)="replyTo.set($event)" (resolve)="store.resolve(m, $event)" />
            }
          </div>
        }
      </ym-async-state>
    </div>

    <ym-composer [conversation]="c" [(replyTo)]="replyTo" />
  `
})
export class ThreadComponent {
  protected readonly store = inject(InboxStore);
  private readonly clock = inject(ClockService);

  readonly conversation = input.required<IInboxConversation>();
  readonly back = output<void>();
  readonly details = output<void>();

  protected readonly kindMeta = INBOX_KIND_META;
  protected readonly statusMeta = INBOX_STATUS_META;
  protected readonly replyTo = signal<IInboxMessage | null>(null);
  protected readonly meta = computed(() => PLATFORM_META[this.conversation().platform]);
  protected readonly name = computed(() => conversationName(this.conversation()));
  protected readonly window = computed(() => windowState(this.conversation(), this.clock.now()));
  protected readonly isComments = computed(() => this.conversation().kind === 'COMMENTS');
  /** Citar un mensaje en privados y grupos: WhatsApp y Telegram lo admiten. */
  protected readonly canQuote = computed(() => this.conversation().platform === 'WHATSAPP' || this.conversation().platform === 'TELEGRAM');

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private lastNewestId: number | null = null;
  private keepScroll = false;

  constructor() {
    // Mensaje nuevo (o conversación nueva): baja al final. Al cargar los anteriores, se mantiene donde estaba.
    afterRenderEffect(() => {
      const newest = this.store.messages.value()?.[0]?.id ?? null;
      const element = this.scroller().nativeElement;
      untracked(() => {
        if (this.keepScroll) {
          this.keepScroll = false;
          return;
        }
        if (newest !== this.lastNewestId) element.scrollTop = element.scrollHeight;
        this.lastNewestId = newest;
      });
    });
  }

  protected loadOlder(): void {
    this.keepScroll = true;
    this.store.messages.loadMore();
  }
}
