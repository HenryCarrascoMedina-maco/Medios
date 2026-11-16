import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PLATFORM_META } from '@core/constants/status.constants';
import { IInboxConversation, IInboxMessage, ITemplate, IVideo } from '@core/models/api.models';
import { ClockService } from '@core/services/clock.service';
import { TemplateStoreService } from '@core/services/template-store.service';
import { inboxCapability, quickReplyQuery, windowState } from '@core/utils/inbox';
import { resolveTemplate, templateFields } from '@core/utils/template-vars';
import { templateOfferedOn, usableTemplateMedia } from '@core/utils/templates';
import { MediaPickerDialog } from '@shared/publish/media-picker.dialog';
import { ChipComponent } from '@shared/ui/chip.component';
import { IconComponent } from '@shared/ui/icon.component';
import { MediaThumbComponent } from '@shared/ui/media-thumb.component';
import { TemplateFieldsComponent } from '@shared/ui/template-fields.component';
import { InboxStore } from './inbox.store';
import { ITemplateChoice, TemplatePickerComponent } from './template-picker.component';

type ComposerMode = 'reply' | 'note' | 'template';

/**
 * Compositor de la bandeja. Las reglas (largo, ventana de 24 h, adjuntos, plantillas, cuota) salen de GET /api/Inbox/Rules:
 * aquí solo se avisa mientras se escribe; el servidor vuelve a validarlo todo.
 */
@Component({
  selector: 'ym-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ChipComponent, IconComponent, MediaPickerDialog, MediaThumbComponent, TemplateFieldsComponent, TemplatePickerComponent],
  host: { class: 'block border-t border-line bg-surface p-3' },
  template: `
    @let cap = capability();
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <div class="inline-flex overflow-hidden rounded-lg border border-line text-xs" role="group" aria-label="Tipo de mensaje">
        <button type="button" class="px-3 py-1" [class]="mode() === 'reply' ? activeSeg : ''" [attr.aria-pressed]="mode() === 'reply'" (click)="mode.set('reply')">Responder</button>
        <button type="button" class="px-3 py-1" [class]="mode() === 'note' ? activeSeg : ''" [attr.aria-pressed]="mode() === 'note'" (click)="mode.set('note')">Nota interna</button>
        @if (cap?.templates) {
          <button type="button" class="px-3 py-1" [class]="mode() === 'template' ? activeSeg : ''" [attr.aria-pressed]="mode() === 'template'" (click)="mode.set('template')">Plantilla</button>
        }
      </div>
      @if (replyTo(); as r) {
        <ym-chip tone="violet">
          Respondiendo a {{ r.authorName ?? 'mensaje' }}
          <button type="button" class="ml-1 opacity-70 hover:opacity-100" aria-label="Quitar respuesta" (click)="replyTo.set(null)"><ym-icon name="close" [size]="10" /></button>
        </ym-chip>
        @if (cap?.privateReply && mode() === 'reply') {
          <label class="flex items-center gap-1 text-xs"><input type="checkbox" [checked]="privateReply()" (change)="privateReply.set(!privateReply())" /> <ym-icon name="lock" [size]="11" /> Por privado</label>
        }
      }
      <span class="flex-1"></span>
      @if (mode() === 'reply' && cap) { <span class="text-[11px] muted" [class.text-red-600]="overLimit()">{{ text().length }} / {{ cap.textMax }}</span> }
    </div>

    @if (mode() === 'reply' && blocked(); as reason) {
      <div class="notice notice-warn mb-2">{{ reason }}</div>
    }
    @if (mode() === 'reply' && cap?.quotaUnits) {
      <p class="mb-2 text-[11px] muted">Cada respuesta en YouTube usa {{ cap!.quotaUnits }} unidades de la cuota diaria.</p>
    }

    @if (mode() === 'template') {
      <ym-template-picker class="mb-2" [connectionId]="conversation().connectionId" (choice)="templateChoice.set($event)" />
    } @else {
      @if (mode() === 'reply' && fieldNames().length) {
        <ym-template-fields class="mb-2" [names]="fieldNames()" [values]="fieldValues()" [autofocus]="true" (valuesChange)="setFields($event)" />
      }
      <div class="relative">
        <textarea class="input min-h-16 resize-y" [placeholder]="mode() === 'note' ? 'Nota para el equipo (no se envía)…' : 'Escribe la respuesta… (/ para tus respuestas · Ctrl+Enter para enviar)'"
                  [ngModel]="text()" (ngModelChange)="typed($event)" (keydown.control.enter)="submit()" (keydown.meta.enter)="submit()"
                  [attr.aria-label]="mode() === 'note' ? 'Nota interna' : 'Respuesta'"></textarea>
        @if (suggestions().length) {
          <ul class="card absolute bottom-full left-0 z-20 mb-1 max-h-64 w-full overflow-y-auto py-1 text-sm" role="listbox" aria-label="Tus respuestas">
            @for (q of suggestions(); track q.id) {
              <li><button type="button" class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-hover" (click)="applyReply(q)">
                @if (q.media.length) { <ym-media-thumb class="w-12 shrink-0 rounded" [media]="firstMedia(q)" [compact]="true" /> }
                <span class="min-w-0 flex-1">
                  <b>/{{ q.shortcut }}</b> @if (q.media.length) { <span class="text-[11px] muted"><ym-icon name="paperclip" [size]="10" /> {{ q.media.length }}</span> }
                  <span class="block truncate text-xs muted">{{ q.body }}</span>
                </span>
              </button></li>
            }
          </ul>
        }
      </div>
    }

    @if (applied(); as a) {
      <p class="mt-1 text-[11px] muted">Respuesta «/{{ a.shortcut }}» aplicada · puedes editar el texto antes de enviar.@if (mediaNotice()) { {{ mediaNotice() }} }</p>
    }
    @if (media().length) {
      <div class="mt-2 flex flex-wrap gap-1.5">
        @for (m of media(); track m.id) {
          <ym-chip>
            <ym-icon name="paperclip" [size]="11" /> {{ m.title }}
            <button type="button" class="ml-1 opacity-70 hover:opacity-100" [attr.aria-label]="'Quitar ' + m.title" (click)="removeMedia(m.id)"><ym-icon name="close" [size]="10" /></button>
          </ym-chip>
        }
      </div>
    }

    <div class="mt-2 flex flex-wrap items-center gap-2">
      @if (mode() === 'reply' && attachmentsAllowed()) {
        <button type="button" class="btn btn-sm" (click)="pickerOpen.set(true)"><ym-icon name="images" [size]="13" /> Desde Medios</button>
      }
      @if (mode() !== 'template') {
        <button type="button" class="btn btn-sm" (click)="typed('/')" [disabled]="!offered().length" title="Tus respuestas (Ajustes › Plantillas)">
          <ym-icon name="zap" [size]="13" /> Respuestas
        </button>
      }
      <span class="flex-1"></span>
      <button type="button" class="btn btn-sm" [class]="mode() === 'note' ? '' : 'btn-primary'" [disabled]="!canSend()" (click)="submit()">
        <ym-icon [name]="mode() === 'note' ? 'note' : 'send'" [size]="13" /> {{ store.busy() ? 'Enviando…' : mode() === 'note' ? 'Guardar nota' : 'Enviar' }}
      </button>
    </div>

    @if (pickerOpen()) {
      <ym-media-picker [exclude]="mediaIds()" (picked)="addMedia($event)" (closed)="pickerOpen.set(false)" />
    }
  `
})
export class ComposerComponent {
  private readonly clock = inject(ClockService);
  private readonly templates = inject(TemplateStoreService);
  protected readonly store = inject(InboxStore);

  readonly conversation = input.required<IInboxConversation>();
  /** Comentario o mensaje al que se responde (lo elige la burbuja). */
  readonly replyTo = model<IInboxMessage | null>(null);

  protected readonly activeSeg = 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900';
  protected readonly mode = signal<ComposerMode>('reply');
  protected readonly text = signal('');
  protected readonly media = signal<IVideo[]>([]);
  protected readonly pickerOpen = signal(false);
  protected readonly privateReply = signal(false);

  protected readonly templateChoice = signal<ITemplateChoice | null>(null);
  /** Respuesta propia (/atajo) elegida: se resuelve con el contacto y sus campos mientras no se edite el texto a mano. */
  protected readonly applied = signal<ITemplate | null>(null);
  protected readonly fieldValues = signal<Readonly<Record<string, string>>>({});
  protected readonly mediaNotice = signal<string | null>(null);
  protected readonly fieldNames = computed(() => templateFields(this.applied()?.body));
  private readonly missingFields = computed(() => this.fieldNames().some(name => !this.fieldValues()[name]?.trim()));
  private readonly templatePicker = viewChild(TemplatePickerComponent);

  protected readonly capability = computed(() => inboxCapability(this.store.rules(), this.conversation().platform, this.conversation().kind));
  protected readonly window = computed(() => windowState(this.conversation(), this.clock.now()));
  protected readonly mediaIds = computed(() => this.media().map(m => m.id));
  protected readonly overLimit = computed(() => !!this.capability() && this.text().length > this.capability()!.textMax);
  protected readonly attachmentsAllowed = computed(() => {
    const cap = this.capability();
    return !!cap?.attachments && (!cap.attachmentsNeedPublicUrl || !!this.store.rules()?.publicMediaAvailable);
  });

  /** Por qué no se puede responder con texto libre ahora (ventana cerrada o plataforma sin respuesta). */
  protected readonly blocked = computed(() => {
    const cap = this.capability();
    const platform = this.conversation().platform;
    const label = PLATFORM_META[platform].label;
    if (!cap || cap.textMax === 0) return `${label} no permite responder a este tipo de conversación desde la app.`;
    const w = this.window();
    // La etiqueta «agente humano» (si Meta la aprobó) alarga Messenger e Instagram a 7 días; el servidor decide.
    const humanAgent = !!this.store.rules()?.humanAgentDays && (platform === 'FACEBOOK' || platform === 'INSTAGRAM');
    if (w?.neverOpened)
      return cap.templates
        ? 'El cliente aún no ha escrito: WhatsApp solo deja empezar con una plantilla aprobada (pestaña «Plantilla»). Cuando conteste podrás escribirle 24 h.'
        : `La persona aún no ha escrito: ${label} no deja escribirle primero.`;
    if (w?.closed && !this.privateReply() && !humanAgent)
      return cap.templates
        ? 'Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo deja enviar una plantilla aprobada (pestaña «Plantilla»).'
        : `Pasaron más de 24 h desde el último mensaje: ${label} no deja responder hasta que la persona vuelva a escribir.`;
    return null;
  });

  protected readonly offered = computed(() => this.templates.replies().filter(t => templateOfferedOn(t, this.conversation().platform)));

  protected readonly suggestions = computed(() => {
    const query = quickReplyQuery(this.text());
    return query == null ? [] : this.offered().filter(q => q.shortcut?.startsWith(query)).slice(0, 8);
  });

  protected readonly canSend = computed(() => {
    if (this.store.busy()) return false;
    switch (this.mode()) {
      case 'note': return this.text().trim().length > 0;
      case 'template': return !!this.templateChoice()?.complete;
      default: return !this.blocked() && !this.overLimit() && !this.missingFields() && (this.text().trim().length > 0 || this.media().length > 0);
    }
  });

  /** Solo cambia al abrir otra conversación (no cuando se actualiza la misma: el borrador se conserva). */
  private readonly conversationId = computed(() => this.conversation().id);

  constructor() {
    void this.templates.ensure();
    // Otra conversación: el borrador se vacía; con la ventana de WhatsApp cerrada se propone la plantilla.
    effect(() => {
      this.conversationId();
      untracked(() => {
        const conversation = this.conversation();
        this.reset();
        const closed = windowState(conversation, Date.now())?.closed;
        this.mode.set(closed && inboxCapability(this.store.rules(), conversation.platform, conversation.kind)?.templates ? 'template' : 'reply');
      });
    });
  }

  protected firstMedia(template: ITemplate): IVideo {
    return usableTemplateMedia(template)[0]?.video ?? { ...usableTemplateMedia({ ...template, media: template.media.map(m => ({ ...m, missing: false })) })[0].video };
  }

  /** Lo que se escribe a mano: si había una respuesta aplicada, el texto ya es del usuario y deja de resolverse. */
  protected typed(value: string): void {
    this.text.set(value);
    if (this.applied() && !this.fieldNames().length) this.applied.set(null);
  }

  /** Respuesta propia: texto con {nombre} y campos resueltos, y sus adjuntos si la red los admite. */
  protected applyReply(template: ITemplate): void {
    this.applied.set(template);
    this.fieldValues.set({});
    this.resolveApplied();
    const media = usableTemplateMedia(template).map(m => m.video);
    const missing = template.media.length - media.length;
    const notes: string[] = [];
    if (media.length && this.attachmentsAllowed()) this.appendMedia(media);
    else if (media.length) notes.push(`Esta conversación no admite archivos: se envía solo el texto.`);
    if (missing) notes.push(missing === 1 ? 'Un archivo ya no está en la biblioteca.' : `${missing} archivos ya no están en la biblioteca.`);
    this.mediaNotice.set(notes.join(' ') || null);
  }

  protected setFields(values: Readonly<Record<string, string>>): void {
    this.fieldValues.set(values);
    this.resolveApplied();
  }

  private resolveApplied(): void {
    const template = this.applied();
    if (!template) return;
    const conversation = this.conversation();
    this.text.set(resolveTemplate(template.body, {
      date: new Date(this.clock.now()),
      account: conversation.accountName,
      contact: conversation.kind === 'DIRECT' ? conversation.contactName : null,
      blocks: this.templates.blockMap(),
      fields: this.fieldValues()
    }));
  }

  protected addMedia(videos: IVideo[]): void {
    this.appendMedia(videos);
    this.pickerOpen.set(false);
  }

  private appendMedia(videos: IVideo[]): void {
    this.media.update(list => [...list, ...videos.filter(v => !list.some(m => m.id === v.id))]);
  }

  protected removeMedia(id: number): void {
    this.media.update(list => list.filter(m => m.id !== id));
  }

  protected async submit(): Promise<void> {
    if (!this.canSend()) return;
    const mode = this.mode();
    const template = this.templateChoice();
    const sent = await this.store.send(mode === 'note'
      ? { note: true, body: this.text().trim() }
      : mode === 'template'
        ? { templateName: template!.name, templateLanguage: template!.language, templateParams: template!.params }
        : {
          body: this.text().trim() || null,
          parentExternalId: this.replyTo()?.externalId ?? null,
          privateReply: this.privateReply(),
          mediaIds: this.mediaIds()
        });
    if (sent) {
      const applied = this.applied();
      if (mode === 'reply' && applied) this.templates.markUsed(applied.id);
      this.reset();
    }
  }

  private reset(): void {
    this.text.set('');
    this.media.set([]);
    this.replyTo.set(null);
    this.privateReply.set(false);
    this.templateChoice.set(null);
    this.templatePicker()?.reset();
    this.applied.set(null);
    this.fieldValues.set({});
    this.mediaNotice.set(null);
  }
}
