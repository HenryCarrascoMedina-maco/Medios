import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { INBOX_MESSAGE_STATUS_META } from '@core/constants/status.constants';
import { InboxHttp } from '@core/http/api.http';
import { IInboxAttachment, IInboxMessage, InboxResolveAction } from '@core/models/api.models';
import { ChipComponent } from '@shared/ui/chip.component';
import { IconComponent } from '@shared/ui/icon.component';

/**
 * Adjunto de un mensaje. Si la plataforma da enlace (Messenger, Instagram) se usa; si guarda el archivo (WhatsApp,
 * Telegram) o es de la biblioteca (lo enviamos nosotros), se descarga con la sesión al pulsar y las imágenes se ven en miniatura.
 */
@Component({
  selector: 'ym-inbox-attachment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let a = attachment();
    @if (preview(); as src) {
      <a [href]="src" target="_blank" rel="noopener"><img [src]="src" [alt]="a.name ?? 'Imagen'" class="mt-1 max-h-48 rounded-lg" /></a>
    } @else {
      <button type="button" class="mt-1 flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs hover:bg-surface-hover" (click)="openFile()">
        <ym-icon [name]="a.kind === 'image' ? 'image' : a.kind === 'video' ? 'film' : 'paperclip'" [size]="13" />
        {{ a.name ?? kindLabel[a.kind] }} @if (loading()) { <ym-icon name="spinner" [size]="12" /> }
      </button>
    }
  `
})
export class InboxAttachmentComponent implements OnInit {
  private readonly http = inject(InboxHttp);
  private readonly destroyRef = inject(DestroyRef);

  readonly messageId = input.required<number>();
  readonly index = input.required<number>();
  readonly attachment = input.required<IInboxAttachment>();

  protected readonly preview = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly kindLabel: Record<IInboxAttachment['kind'], string> = {
    image: 'Imagen', video: 'Video', audio: 'Audio', document: 'Documento', sticker: 'Sticker', other: 'Adjunto'
  };
  private objectUrl: string | null = null;

  ngOnInit(): void {
    const a = this.attachment();
    // La copia local (o el archivo de la biblioteca) sigue valiendo cuando el enlace de la red ya caducó.
    if (a.kind === 'image' && (a.storedPath || a.libraryId || (a.mediaId && !a.url))) void this.load().then(url => this.preview.set(url));
    else if (a.kind === 'image' && a.url) this.preview.set(a.url);
    this.destroyRef.onDestroy(() => this.objectUrl && URL.revokeObjectURL(this.objectUrl));
  }

  protected async openFile(): Promise<void> {
    const a = this.attachment();
    const url = a.storedPath || !a.url ? await this.load() : a.url;
    if (url) window.open(url, '_blank', 'noopener');
  }

  private async load(): Promise<string | null> {
    if (this.objectUrl) return this.objectUrl;
    this.loading.set(true);
    try {
      const blob = await firstValueFrom(this.http.attachment(this.messageId(), this.index()));
      this.objectUrl = URL.createObjectURL(blob);
      return this.objectUrl;
    } catch {
      return null;
    } finally {
      this.loading.set(false);
    }
  }
}

/** Una burbuja: entrante, propia (con su estado y qué hacer si falló) o nota interna. */
@Component({
  selector: 'ym-message-bubble',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ChipComponent, IconComponent, InboxAttachmentComponent],
  host: { class: 'flex flex-col', '[class.items-end]': "m().direction === 'OUT'", '[class.items-center]': "m().direction === 'NOTE'" },
  template: `
    @let msg = m();
    <div class="max-w-[85%] rounded-xl border px-3 py-2 text-sm leading-relaxed sm:max-w-[75%]" [class]="tone()">
      @if (msg.direction === 'NOTE') {
        <div class="mb-0.5 flex items-center gap-1 text-[11px] font-semibold"><ym-icon name="note" [size]="12" /> Nota interna · {{ msg.createdBy }}</div>
      } @else if (showAuthor() && msg.authorName) {
        <div class="mb-0.5 text-[11px] font-semibold">{{ msg.authorName }}</div>
      }
      @if (msg.privateReply) { <div class="mb-0.5 flex items-center gap-1 text-[11px] muted"><ym-icon name="lock" [size]="11" /> Respuesta privada</div> }
      @if (msg.body) { <div class="whitespace-pre-wrap break-words">{{ msg.body }}</div> }
      @for (a of msg.attachments; track $index) {
        <ym-inbox-attachment [messageId]="msg.id" [index]="$index" [attachment]="a" />
      }
      <div class="mt-1 flex items-center justify-end gap-1.5 text-[10px] muted">
        {{ msg.sentAt | date: 'dd/MM HH:mm' }}
        @if (msg.direction === 'OUT') { <ym-chip [tone]="status().tone">{{ status().label }}</ym-chip> }
      </div>
    </div>
    @if (msg.errorMessage && (msg.statusCode === 'FAILED' || msg.statusCode === 'NEEDS_REVIEW')) {
      <div class="mt-1 max-w-[85%] text-xs text-red-600 dark:text-red-400 sm:max-w-[75%]" role="alert">{{ msg.errorMessage }}</div>
      <div class="mt-1 flex flex-wrap gap-1.5">
        <button type="button" class="btn btn-sm" (click)="resolve.emit('RETRY')"><ym-icon name="retry" [size]="12" /> Reintentar</button>
        @if (msg.statusCode === 'NEEDS_REVIEW') { <button type="button" class="btn btn-sm" (click)="resolve.emit('MARK_SENT')"><ym-icon name="check" [size]="12" /> Ya se envió</button> }
        <button type="button" class="btn btn-ghost btn-sm" (click)="resolve.emit('CANCEL')">Descartar</button>
      </div>
    } @else if (canReply()) {
      <button type="button" class="mt-0.5 text-[11px] font-semibold text-blue-600 hover:underline dark:text-sky-400" (click)="reply.emit(msg)">Responder</button>
    }
  `
})
export class MessageBubbleComponent {
  readonly m = input.required<IInboxMessage>();
  /** Comentarios y grupos: muchas personas escriben, se muestra quién. */
  readonly showAuthor = input(false);
  readonly canReply = input(false);

  readonly resolve = output<InboxResolveAction>();
  readonly reply = output<IInboxMessage>();

  protected readonly status = computed(() => INBOX_MESSAGE_STATUS_META[this.m().statusCode]);
  protected readonly tone = computed(() => {
    switch (this.m().direction) {
      case 'OUT': return 'border-transparent bg-brand-soft dark:bg-brand/15';
      case 'NOTE': return 'border-dashed border-amber-400 bg-amber-50 dark:bg-amber-500/10';
      default: return 'border-line bg-surface';
    }
  });
}
