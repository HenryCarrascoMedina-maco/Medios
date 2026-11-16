import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { InboxHttp } from '@core/http/api.http';
import {
  IInboxConversation, IInboxMessage, IInboxReply, IInboxRules, IInboxUpdate, InboxKind, InboxResolveAction, InboxStatus, Platform
} from '@core/models/api.models';
import { EntityHubService } from '@core/services/entity-hub.service';
import { InboxCountsService } from '@core/services/inbox-counts.service';
import { ToastService } from '@core/services/toast.service';
import { apiError } from '@core/utils/format';
import { createCursorLoader } from '@core/utils/paged-loader';

export interface IInboxFilters {
  status: InboxStatus | '';
  platform: Platform | '';
  kind: InboxKind | '';
  unread: boolean;
  awaiting: boolean;
  searchTerm: string;
}

export const DEFAULT_FILTERS: IInboxFilters = { status: 'OPEN', platform: '', kind: '', unread: false, awaiting: false, searchTerm: '' };

/** Un comentario principal con sus respuestas (las conversaciones de comentarios se pintan así). */
export interface ICommentThread {
  root: IInboxMessage;
  replies: IInboxMessage[];
}

/**
 * Estado de la bandeja (uno por pantalla): filtros, lista paginada por cursor, conversación abierta y sus mensajes.
 * Los eventos «Inbox» del hub actualizan solo lo que cambió, sin recargar la lista entera.
 */
@Injectable()
export class InboxStore {
  private readonly http = inject(InboxHttp);
  private readonly hub = inject(EntityHubService);
  private readonly counts = inject(InboxCountsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly filters = signal<IInboxFilters>(DEFAULT_FILTERS);
  readonly conversations = createCursorLoader<IInboxConversation>((last, take) => this.http.conversations({
    ...this.filters(),
    beforeAt: last?.lastMessageAt,
    beforeId: last?.id,
    take
  }), { errorMessage: 'No se pudo cargar la bandeja.' });

  readonly selectedId = signal<number | null>(null);
  readonly selected = signal<IInboxConversation | null>(null);
  /** Del más nuevo al más viejo (así pagina el servidor); la conversación se pinta al revés. */
  readonly messages = createCursorLoader<IInboxMessage>((last, take) => {
    const id = this.selectedId();
    return this.http.messages(id ?? 0, last ? { sentAt: last.sentAt, id: last.id } : null, take);
  }, { take: 50, errorMessage: 'No se pudieron cargar los mensajes.' });

  readonly rules = signal<IInboxRules | null>(null);
  readonly busy = signal(false);

  /** Mensajes en orden de lectura (el más viejo arriba). */
  readonly timeline = computed(() => [...(this.messages.value() ?? [])].reverse());

  /** Comentarios agrupados por hilo: principal y respuestas; las notas internas van como hilos sueltos. */
  readonly threads = computed<ICommentThread[]>(() => {
    const list = this.timeline();
    const byExternal = new Map<string, ICommentThread>();
    const threads: ICommentThread[] = [];
    for (const message of list) {
      const parent = message.parentExternalId ? byExternal.get(message.parentExternalId) : undefined;
      if (parent) {
        parent.replies.push(message);
        continue;
      }
      const thread: ICommentThread = { root: message, replies: [] };
      threads.push(thread);
      if (message.externalId) byExternal.set(message.externalId, thread);
    }
    return threads;
  });

  constructor() {
    // Filtros nuevos: la lista empieza de cero.
    effect(() => {
      this.filters();
      untracked(() => this.conversations.reset());
    });
    this.hub.on('Inbox').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(update => void this.onUpdate(update));
    this.hub.reconnected$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.conversations.reload();
      if (this.selectedId() != null) this.messages.reload();
    });
    void this.loadReferenceData();
  }

  setFilters(changes: Partial<IInboxFilters>): void {
    this.filters.update(filters => ({ ...filters, ...changes }));
  }

  /** Abre una conversación: sus datos, sus mensajes y la marca como leída. */
  async select(id: number | null): Promise<void> {
    if (id === this.selectedId()) return;
    this.selectedId.set(id);
    this.selected.set(this.conversations.value()?.find(c => c.id === id) ?? null);
    if (id == null) return;
    this.messages.reset();
    try {
      const conversation = await firstValueFrom(this.http.conversation(id));
      if (this.selectedId() !== id) return;
      this.selected.set(conversation);
      if (conversation.unreadCount > 0) await this.update(id, { markRead: true }, false);
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudo abrir la conversación.'));
    }
  }

  /** Respuesta o nota: el mensaje vuelve ya guardado (en cola) y aparece al momento. */
  async send(reply: IInboxReply): Promise<boolean> {
    const id = this.selectedId();
    if (id == null) return false;
    this.busy.set(true);
    try {
      const message = await firstValueFrom(this.http.send(id, reply));
      this.messages.value.update(list => [message, ...(list ?? [])]);
      void this.refreshConversation(id);
      return true;
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudo enviar.'));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async resolve(message: IInboxMessage, action: InboxResolveAction): Promise<void> {
    try {
      const updated = await firstValueFrom(this.http.resolve(message.id, action));
      this.replaceMessage(updated);
    } catch (error) {
      this.toast.error(apiError(error));
    }
  }

  async update(id: number, changes: { statusCode?: InboxStatus; markRead?: boolean; tags?: string[] }, notify = true): Promise<void> {
    try {
      const updated = await firstValueFrom(this.http.update(id, changes));
      this.replaceConversation(updated);
      this.counts.refresh();
      if (notify && changes.statusCode === 'CLOSED') this.toast.success('Conversación cerrada.');
    } catch (error) {
      this.toast.error(apiError(error));
    }
  }

  replaceMessage(message: IInboxMessage): void {
    this.messages.value.update(list => list?.map(m => (m.id === message.id ? message : m)));
  }

  /** Aviso del hub: se trae solo esa conversación y, si está abierta, sus mensajes nuevos. */
  private async onUpdate(update: IInboxUpdate): Promise<void> {
    await this.refreshConversation(update.conversationId, update.isNew);
    if (update.conversationId === this.selectedId()) await this.refreshMessages(update.conversationId);
  }

  private async refreshConversation(id: number, isNew = false): Promise<void> {
    try {
      const conversation = await firstValueFrom(this.http.conversation(id));
      if (this.conversations.value()?.some(c => c.id === id) || isNew) this.replaceConversation(conversation, isNew && this.matches(conversation));
    } catch {
      // Se verá al recargar la lista.
    }
  }

  /** Primera página de mensajes fusionada con lo cargado (no se pierde el historial ya leído). */
  private async refreshMessages(id: number): Promise<void> {
    try {
      const latest = await firstValueFrom(this.http.messages(id));
      if (this.selectedId() !== id) return;
      this.messages.value.update(list => {
        const fresh = new Map(latest.map(m => [m.id, m]));
        const older = (list ?? []).filter(m => !fresh.has(m.id) && latest.length > 0 && m.sentAt <= latest[latest.length - 1].sentAt);
        return [...latest, ...older];
      });
      if (this.selected()?.unreadCount) void this.update(id, { markRead: true }, false);
    } catch {
      // El siguiente aviso o la recarga lo traerán.
    }
  }

  /** Sustituye la conversación en la lista (o la pone arriba si es nueva y pasa los filtros). */
  private replaceConversation(conversation: IInboxConversation, prependIfMissing = false): void {
    if (conversation.id === this.selectedId()) this.selected.set(conversation);
    this.conversations.value.update(list => {
      if (!list) return list;
      const others = list.filter(c => c.id !== conversation.id);
      const present = others.length !== list.length;
      if (!present && !prependIfMissing) return list;
      if (!this.matches(conversation)) return others;
      return [conversation, ...others].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || b.id - a.id);
    });
  }

  /** ¿Entra la conversación en los filtros actuales? (la búsqueda de texto la resuelve el servidor). */
  private matches(c: IInboxConversation): boolean {
    const f = this.filters();
    return (!f.status || c.statusCode === f.status)
      && (!f.platform || c.platform === f.platform)
      && (!f.kind || c.kind === f.kind)
      && (!f.unread || c.unreadCount > 0)
      && (!f.awaiting || (c.awaitingSince != null && c.statusCode !== 'CLOSED'));
  }

  private async loadReferenceData(): Promise<void> {
    try {
      this.rules.set(await firstValueFrom(this.http.rules()));
    } catch {
      // Sin reglas el compositor no avisa mientras se escribe; el servidor valida igual al enviar.
    }
  }
}
