import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, WritableSignal, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PLATFORM_META } from '@core/constants/status.constants';
import { ConnectionHttp, PublicationHttp, TemplateHttp } from '@core/http/api.http';
import { ICategory, IConnection, ITemplate, IVideo, PostKind } from '@core/models/api.models';
import { ClockService } from '@core/services/clock.service';
import { RulesService } from '@core/services/rules.service';
import { TemplateStoreService } from '@core/services/template-store.service';
import { ToastService } from '@core/services/toast.service';
import { mapSettled } from '@core/utils/concurrency';
import { apiError, formatBytes, formatDuration, isShort, toLocalInput } from '@core/utils/format';
import { inferPostKind, isTeamsWebhook, isValidLink, mediaKindOf } from '@core/utils/post-kind';
import { YOUTUBE_UNVERIFIED_MAX_SECONDS, postBlockers } from '@core/utils/publication-rules';
import { readStored, removeStored, writeStored } from '@core/utils/storage';
import { templateFields, unknownBlocks } from '@core/utils/template-vars';
import { usableTemplateMedia } from '@core/utils/templates';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { ChoiceGroupComponent, IChoice } from '@shared/ui/choice-group.component';
import { IconComponent } from '@shared/ui/icon.component';
import { ModalComponent } from '@shared/ui/modal.component';
import { PlatformBadgeComponent } from '@shared/ui/platform-badge.component';
import { PostKindBadgeComponent } from '@shared/ui/post-kind-badge.component';
import { TemplateEditorComponent } from '@shared/ui/template-editor.component';
import { TemplateFieldsComponent } from '@shared/ui/template-fields.component';
import { FacebookSettingsComponent } from './facebook-settings.component';
import { FirstCommentFieldComponent } from './first-comment-field.component';
import { InstagramSettingsComponent } from './instagram-settings.component';
import { LinkedinSettingsComponent } from './linkedin-settings.component';
import { MediaPickerDialog } from './media-picker.dialog';
import { MediaStripComponent } from './media-strip.component';
import { PublishPreviewComponent } from './publish-preview.component';
import {
  IDraft, IMediaItem, IPublishContext, TiktokInfoState, accountCapability, draftCounters, draftErrors, finalText, newDraft, staggeredPublishAt, toDestination, toPublicationRequest
} from './publish.models';
import { TeamsSettingsComponent } from './teams-settings.component';
import { TelegramSettingsComponent } from './telegram-settings.component';
import { TiktokSettingsComponent } from './tiktok-settings.component';
import { YoutubeSettingsComponent } from './youtube-settings.component';
import { ReqComponent } from '@shared/ui/req.component';

const YES_NO: readonly IChoice<boolean>[] = [{ value: false, label: 'No' }, { value: true, label: 'Sí' }];
const KIDS: readonly IChoice<boolean>[] = [{ value: false, label: 'No' }, { value: true, label: 'Sí, es para niños' }];
const YOUTUBE_DEFAULT_CATEGORY = '26';
const DRAFT_KEY = 'ym.publish.draft.';
const PUBLISH_CONCURRENCY = 2;

/** Programación inicial: fecha de la primera publicación y separación entre ellas (0 = misma hora). */
export interface IPublishSchedule {
  start: Date;
  intervalMs: number;
}

/** Borrador en localStorage bajo DRAFT_KEY + ids de los medios (o «nuevo»). */
interface ISavedDraft {
  savedAt: number;
  title: string;
  description: string;
  linkUrl?: string;
  madeForKids: boolean;
  synthetic: boolean | null;
  selected: number[];
  drafts: Record<number, IDraft>;
  templateId: number | null;
  fields?: Record<string, string>;
}

/**
 * Publicar en varias cuentas a la vez, en dos modos:
 *  - Componer una publicación: texto + 0..N medios o un enlace; el tipo se deduce de los medios.
 *  - En serie: varios medios, una publicación por cada uno (resolviendo {titulo}, {fecha}…).
 * Cada cuenta indica si está disponible y por qué no, con las mismas reglas que la API (GET /api/Publication/Rules).
 */
@Component({
  selector: 'ym-publish-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, RouterLink, ModalComponent, AccountAvatarComponent, ChoiceGroupComponent, IconComponent, PlatformBadgeComponent, PostKindBadgeComponent, TemplateEditorComponent, TemplateFieldsComponent,
    PublishPreviewComponent, YoutubeSettingsComponent, FacebookSettingsComponent, InstagramSettingsComponent, TelegramSettingsComponent, TiktokSettingsComponent,
    LinkedinSettingsComponent, TeamsSettingsComponent, FirstCommentFieldComponent, MediaStripComponent, MediaPickerDialog,
    ReqComponent
  ],
  templateUrl: './publish.dialog.html'
})
export class PublishDialog implements OnInit {
  private readonly publications = inject(PublicationHttp);
  private readonly connectionsHttp = inject(ConnectionHttp);
  private readonly templateHttp = inject(TemplateHttp);
  private readonly toast = inject(ToastService);
  private readonly clock = inject(ClockService);
  private readonly rulesService = inject(RulesService);
  protected readonly store = inject(TemplateStoreService);
  private readonly modal = viewChild.required(ModalComponent);
  private categoriesRequested = false;
  private draftStorageKey = DRAFT_KEY + 'nuevo';

  readonly videos = input<IVideo[]>([]);
  /** true = los medios forman UNA publicación; false con varios = una publicación por medio (en serie). */
  readonly asPost = input(false);
  readonly accounts = input.required<IConnection[]>();
  /** Cuentas marcadas al abrir; si no hay, las preseleccionadas (★) de cada plataforma. */
  readonly preselected = input<number[]>([]);
  readonly schedule = input<IPublishSchedule | null>(null);
  /** Plantilla que se aplica al abrir; sin ella, la predeterminada. */
  readonly template = input<ITemplate | null>(null);
  readonly closed = output<void>();
  readonly published = output<void>();

  protected readonly meta = PLATFORM_META;
  protected readonly rules = this.rulesService.rules;
  protected readonly yesNo = YES_NO;
  protected readonly kids = KIDS;

  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly linkUrl = signal('');
  protected readonly media = signal<readonly IMediaItem[]>([]);
  protected readonly picking = signal(false);
  protected readonly madeForKids = signal(false);
  protected readonly synthetic = signal<boolean | null>(null);
  protected readonly consent = signal(false);
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  protected readonly drafts = signal<Record<number, IDraft>>({});
  protected readonly activeId = signal<number | null>(null);
  protected readonly categories = signal<ICategory[]>([]);
  protected readonly tiktokInfo = signal<Record<number, TiktokInfoState>>({});
  protected readonly saving = signal(false);
  /** El usuario cambió algo: cerrar pide confirmación y se guarda el borrador. */
  protected readonly dirty = signal(false);
  protected readonly templateId = signal<number | null>(null);
  /** Etiquetas de la plantilla: valor inicial de las etiquetas de cada canal de YouTube. */
  private readonly templateTags = signal('');
  protected readonly savingTemplate = signal<string | null>(null);
  /** Borrador de una sesión anterior que se ofrece restaurar. */
  protected readonly savedDraft = signal<ISavedDraft | null>(null);
  protected readonly fieldValues = signal<Readonly<Record<string, string>>>({});
  /** Qué pasó con los adjuntos al aplicar una plantilla. */
  protected readonly templateNotice = signal<string | null>(null);
  private readonly intervalMs = computed(() => this.schedule()?.intervalMs ?? 0);

  protected readonly series = computed(() => !this.asPost() && this.videos().length > 1);
  protected readonly single = computed(() => !this.series());
  protected readonly posts = computed<IVideo[][]>(() => (this.series() ? this.videos().map(v => [v]) : [this.media().map(m => m.video)]));
  protected readonly composed = computed(() => inferPostKind(this.posts()[0], this.media().length ? '' : this.linkUrl()));
  protected readonly firstMedia = computed<IVideo | null>(() => this.posts()[0][0] ?? null);
  protected readonly activeKind = computed<PostKind>(() => this.kindOf(0) ?? 'TEXT');
  protected readonly groups = computed(() =>
    this.rulesService.publishPlatforms().map(platform => ({ platform, accounts: this.accounts().filter(a => a.platform === platform) })).filter(g => g.accounts.length > 0));
  protected readonly chosen = computed(() => this.accounts().filter(a => this.selected().has(a.id)));
  protected readonly active = computed<IConnection | null>(() => this.chosen().find(a => a.id === this.activeId()) ?? this.chosen()[0] ?? null);
  protected readonly hasYoutube = computed(() => this.chosen().some(a => a.platform === 'YOUTUBE'));
  protected readonly hasAigcQuestion = computed(() => this.chosen().some(a => a.platform === 'YOUTUBE' || a.platform === 'TIKTOK'));
  /** Asteriscos del texto común, con las mismas reglas que destinationErrors (TITLED y TEXT_ONLY). */
  protected readonly titleRequired = computed(() => this.series() || this.composed().kind === 'VIDEO' || this.composed().kind === 'DOCUMENT');
  protected readonly textRequired = computed(() => !this.series() && (this.composed().kind === 'TEXT' || this.composed().kind === 'LINK'));
  protected readonly hasTiktok = computed(() => this.chosen().some(a => a.platform === 'TIKTOK'));
  protected readonly hasBrandedTiktok = computed(() => this.chosen().some(a => a.platform === 'TIKTOK' && this.drafts()[a.id]?.brandContent));

  private readonly allVideos = computed(() => this.posts().flat().filter(m => mediaKindOf(m) === 'VIDEO'));
  protected readonly short = computed(() => this.allVideos().some(v => isShort(v.width, v.height, v.durationSec)));
  protected readonly longVideo = computed(() => this.allVideos().some(v => (v.durationSec ?? 0) > YOUTUBE_UNVERIFIED_MAX_SECONDS));
  /** Nombre de lo que se publica en serie: «videos» o, si hay de todo, «medios». */
  private readonly seriesNoun = computed(() => (this.videos().every(v => mediaKindOf(v) === 'VIDEO') ? ['video', 'videos'] : ['medio', 'medios']));
  protected readonly fileInfo = computed(() => {
    const v = this.firstMedia();
    if (!v || this.posts()[0].length !== 1) return null;
    const resolution = v.width && v.height ? ` · ${v.width}×${v.height}` : '';
    const duration = mediaKindOf(v) === 'VIDEO' ? ` · ${formatDuration(v.durationSec)}` : '';
    return `${v.originalFileName} · ${formatBytes(v.sizeBytes)}${duration}${resolution}`;
  });
  protected readonly dialogTitle = computed(() => {
    if (this.series()) return `Publicar ${this.videos().length} ${this.seriesNoun()[1]}`;
    const media = this.posts()[0];
    return media.length === 1 ? `Publicar «${media[0].title}»` : 'Nueva publicación';
  });

  private readonly texts = computed(() =>
    [this.title(), this.description(), ...Object.values(this.drafts()).flatMap(d => [d.title ?? '', d.description ?? '', d.firstComment ?? ''])]);

  /** Bloques inexistentes: se avisan porque se publicarían como texto literal. */
  protected readonly missingBlocks = computed(() => {
    const blocks = this.store.blockMap();
    return [...new Set(this.texts().flatMap(t => unknownBlocks(t, blocks)))];
  });

  protected readonly fieldNames = computed(() => templateFields(...this.texts()));

  private kindOf(index: number): PostKind | null {
    return this.series() ? inferPostKind(this.posts()[index]).kind : this.composed().kind;
  }

  private target(account: IConnection, index: number): { draft: IDraft; ctx: IPublishContext } {
    const media = this.posts()[index];
    const base = this.draft(account.id);
    const publishAt = staggeredPublishAt(base.publishAt, index, this.intervalMs());
    const now = this.clock.now();
    const vars = {
      video: media[0] ?? null, signature: account.signature, account: account.alias ?? account.displayName,
      blocks: this.store.blockMap(), fields: this.fieldValues(), now
    };
    const text = finalText({ ...base, publishAt }, { title: this.title(), description: this.description() }, vars);
    const firstComment = finalText({ title: null, description: base.firstComment, publishAt }, { title: '', description: '' }, vars).description;
    return {
      draft: { ...base, publishAt, title: null, description: null, firstComment },
      ctx: {
        media, kind: this.kindOf(index) ?? 'TEXT', title: text.title, description: text.description,
        madeForKids: this.madeForKids(), synthetic: this.synthetic(), now, rules: this.rulesService.rules()
      }
    };
  }

  /** Por qué cada cuenta no admite esta publicación (sin mirar el texto); se muestra en la lista de destinos. */
  protected readonly blockers = computed(() => {
    const rules = this.rulesService.rules();
    const posts = this.posts().map((media, index) => ({ media, kind: this.kindOf(index) }));
    const result: Record<number, string[]> = {};
    for (const a of this.accounts())
      result[a.id] = [...new Set(posts.flatMap(p => (p.kind ? postBlockers(a.platform, { kind: p.kind, media: p.media }, rules, isTeamsWebhook(a)) : [])))];
    return result;
  });

  protected readonly postErrors = computed(() => {
    if (this.series()) return [];
    const errors: string[] = [];
    const composed = this.composed();
    if (composed.error) errors.push(composed.error);
    if (this.media().length > this.rules().maxMedia) errors.push(`como mucho ${this.rules().maxMedia} medios por publicación`);
    if (!this.media().length && this.linkUrl().trim() && !isValidLink(this.linkUrl())) errors.push('el enlace no es una dirección web válida (https://…)');
    return errors;
  });

  /** Errores por cuenta sumando los de cada publicación, con el mismo cálculo que la API. */
  protected readonly accountErrors = computed(() => {
    const result: Record<number, string[]> = {};
    for (const account of this.chosen()) {
      const errors = new Set<string>();
      this.posts().forEach((media, index) => {
        const { draft, ctx } = this.target(account, index);
        const prefix = this.single() ? '' : `«${media[0]?.title}»: `;
        for (const e of draftErrors(account, draft, ctx, this.tiktokInfo()[account.id])) errors.add(e.startsWith('la fecha') || e.startsWith('máximo') || e.startsWith('mínimo') ? prefix + e : e);
      });
      result[account.id] = [...errors];
    }
    return result;
  });

  protected readonly errors = computed(() => {
    const errors = [...this.postErrors()];
    if (this.chosen().length === 0) errors.push('elige al menos una cuenta');
    for (const account of this.chosen()) {
      const list = this.accountErrors()[account.id];
      if (list.length) errors.push(`${this.name(account)}: ${list.join(', ')}`);
    }
    const empty = this.fieldNames().filter(name => !this.fieldValues()[name]?.trim());
    if (empty.length) errors.push(`completa los datos de la plantilla: ${empty.join(', ')}`);
    if (!this.consent()) errors.push('falta el consentimiento');
    return errors;
  });

  protected readonly preview = computed(() => {
    const account = this.active();
    if (!account) return null;
    const { draft, ctx } = this.target(account, 0);
    return {
      account, media: ctx.media, kind: ctx.kind, title: ctx.title, description: ctx.description, privacy: draft.privacy,
      counters: draftCounters(account.platform, newDraft(), ctx)
    };
  });

  protected readonly seriesDates = computed(() => {
    const account = this.active();
    if (!account || this.single() || !this.draft(account.id).publishAt) return [];
    return this.videos().map((video, i) => ({ video, at: new Date(staggeredPublishAt(this.draft(account.id).publishAt, i, this.intervalMs())) }));
  });

  constructor() {
    // Solo se guarda borrador al componer una publicación, no en serie.
    effect(() => {
      if (!this.dirty() || !this.single()) return;
      const state: ISavedDraft = {
        savedAt: Date.now(),
        title: this.title(),
        description: this.description(),
        linkUrl: this.linkUrl(),
        madeForKids: this.madeForKids(),
        synthetic: this.synthetic(),
        selected: [...this.selected()],
        drafts: this.drafts(),
        templateId: this.templateId(),
        fields: { ...this.fieldValues() }
      };
      untracked(() => writeStored(this.draftStorageKey, state));
    });
  }

  ngOnInit(): void {
    const first = this.videos()[0] ?? null;
    if (this.single()) this.media.set(this.videos().map(video => ({ video, alt: '' })));
    this.draftStorageKey = DRAFT_KEY + (this.videos().map(v => v.id).join('-') || 'nuevo');

    // Un medio: su título. En serie: {titulo} para que cada uno lleve el suyo. Sin medios: vacío.
    this.title.set(this.series() ? '{titulo}' : first ? first.title.slice(0, this.rulesService.rules().youtubeTitleMax) : '');
    this.description.set(this.series() ? '{titulo}' : first && mediaKindOf(first) === 'VIDEO' ? first.title : '');

    // Se espera a las reglas del servidor para no preseleccionar una cuenta que no admite este tipo.
    void this.rulesService.ensure().then(() => {
      if (this.dirty() || this.selected().size) return;
      const preselected = this.preselected().length ? this.preselected() : this.accounts().filter(a => a.isDefault).map(a => a.id);
      for (const id of preselected) if (this.accounts().some(a => a.id === id) && !this.blockers()[id]?.length) this.select(id);
    });

    if (this.single()) {
      const saved = readStored<ISavedDraft | null>(this.draftStorageKey, null);
      if (saved?.savedAt) this.savedDraft.set(saved);
    }
    void this.store.ensure().then(() => {
      // La plantilla pedida al abrir manda sobre un borrador guardado; la predeterminada, no.
      const chosen = this.template();
      if (chosen) {
        this.savedDraft.set(null);
        this.applyTemplate(chosen, false);
        return;
      }
      const preferred = this.store.defaultTemplate();
      if (preferred && !this.dirty() && !this.savedDraft()) this.applyTemplate(preferred, false);
    });
  }

  protected edit<T>(target: WritableSignal<T>, value: T): void {
    target.set(value);
    this.dirty.set(true);
  }

  protected canComment(account: IConnection): boolean {
    return accountCapability(account, this.rules()).firstComment;
  }

  protected setMedia(items: readonly IMediaItem[]): void {
    this.edit(this.media, items);
  }

  /** Medios elegidos en la biblioteca: se añaden al final, sin repetir. */
  protected addMedia(list: IVideo[]): void {
    const present = new Set(this.media().map(m => m.video.id));
    this.setMedia([...this.media(), ...list.filter(v => !present.has(v.id)).map(video => ({ video, alt: '' }))]);
    this.picking.set(false);
  }

  protected excluded(): number[] {
    return this.media().map(m => m.video.id);
  }

  protected chooseTemplate(value: string): void {
    const template = this.store.publishTemplates().find(t => t.id === Number(value));
    if (template) this.applyTemplate(template, true);
    else {
      this.templateId.set(null);
      this.templateNotice.set(null);
    }
  }

  protected async saveAsTemplate(): Promise<void> {
    const name = this.savingTemplate()?.trim();
    if (!name) return;
    try {
      // En serie, los medios son de cada publicación y no se guardan en la plantilla.
      const media = this.single() ? this.media().map(m => ({ mediaId: m.video.id, alt: m.alt })) : [];
      const id = await firstValueFrom(this.templateHttp.save({
        usage: 'PUBLISH', name, title: this.title(), body: this.description(), tags: this.templateTags(), platforms: [], isDefault: false, media
      }));
      await this.store.reload();
      this.templateId.set(id);
      this.savingTemplate.set(null);
      this.toast.success(`Plantilla «${name}» guardada.`);
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudo guardar la plantilla.'));
    }
  }

  protected restoreDraft(): void {
    const saved = this.savedDraft();
    if (!saved) return;
    this.title.set(saved.title);
    this.description.set(saved.description);
    this.linkUrl.set(saved.linkUrl ?? '');
    this.madeForKids.set(saved.madeForKids);
    this.synthetic.set(saved.synthetic);
    this.templateId.set(saved.templateId);
    this.fieldValues.set(saved.fields ?? {});
    this.drafts.set(Object.fromEntries(Object.entries(saved.drafts).map(([id, d]) => [id, { ...newDraft(), ...d }])));
    this.selected.set(new Set());
    for (const id of saved.selected) if (this.accounts().some(a => a.id === id)) this.select(id);
    this.savedDraft.set(null);
    this.dirty.set(true);
  }

  protected discardDraft(): void {
    removeStored(this.draftStorageKey);
    this.savedDraft.set(null);
  }

  protected toggle(id: number): void {
    this.dirty.set(true);
    if (this.selected().has(id)) {
      const next = new Set(this.selected());
      next.delete(id);
      this.selected.set(next);
    } else {
      this.select(id);
    }
  }

  protected draft(id: number): IDraft {
    return this.drafts()[id] ?? this.initialDraft();
  }

  protected patch(id: number, changes: Partial<IDraft>): void {
    this.drafts.update(all => ({ ...all, [id]: { ...this.draft(id), ...changes } }));
  }

  protected edited(id: number, changes: Partial<IDraft>): void {
    this.patch(id, changes);
    this.dirty.set(true);
  }

  protected name(account: IConnection): string {
    return `${PLATFORM_META[account.platform].label} · ${account.alias ?? account.displayName}`;
  }

  protected effectiveTitle(id: number): string {
    return this.draft(id).title ?? this.title();
  }

  protected effectiveDescription(id: number): string {
    return this.draft(id).description ?? this.description();
  }

  /** Flechas izquierda/derecha entre pestañas (patrón ARIA de tabs). */
  protected onTabKey(event: KeyboardEvent, index: number): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const list = this.chosen();
    const next = list[(index + step + list.length) % list.length];
    this.activeId.set(next.id);
    queueMicrotask(() => document.getElementById(`pub-tab-${next.id}`)?.focus());
  }

  protected loadTiktok(id: number): void {
    this.tiktokInfo.update(all => ({ ...all, [id]: 'loading' }));
    firstValueFrom(this.connectionsHttp.tiktokCreatorInfo(id))
      .then(info => this.tiktokInfo.update(all => ({ ...all, [id]: info })))
      .catch(error => this.tiktokInfo.update(all => ({ ...all, [id]: { error: apiError(error, 'TikTok no respondió.') } })));
  }

  protected cancel(): void {
    void this.modal().requestClose();
  }

  /** Un POST por publicación con las mismas cuentas; un único aviso con el resumen. */
  protected async submit(): Promise<void> {
    if (this.errors().length > 0 || this.saving()) return;
    this.saving.set(true);
    try {
      const accounts = this.chosen();
      const indexes = this.posts().map((_, index) => index);
      const results = await mapSettled(indexes, PUBLISH_CONCURRENCY, index => {
        const media: readonly IMediaItem[] = this.series() ? [{ video: this.videos()[index], alt: '' }] : this.media();
        const destinations = accounts.map(a => {
          const { draft, ctx } = this.target(a, index);
          return toDestination(a, draft, ctx);
        });
        return firstValueFrom(this.publications.create(toPublicationRequest(media, this.series() ? '' : this.linkUrl(), this.postTitle(index), this.consent(), destinations)));
      });
      this.summarize(results);
      if (results.some(r => r.status === 'fulfilled')) {
        const templateId = this.templateId();
        if (templateId) this.store.markUsed(templateId);
        removeStored(this.draftStorageKey);
        this.published.emit();
      }
    } finally {
      this.saving.set(false);
    }
  }

  /** Título común resuelto: nombra la publicación en las listas aunque no tenga medios. */
  private postTitle(index: number): string {
    const vars = { video: this.posts()[index][0] ?? null, signature: null, blocks: this.store.blockMap(), fields: this.fieldValues(), now: this.clock.now() };
    return finalText({ title: null, description: null, publishAt: '' }, { title: this.title(), description: '' }, vars).title;
  }

  private summarize(results: PromiseSettledResult<{ accountName: string; error: string | null }[]>[]): void {
    const rows = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
    const queued = rows.filter(r => !r.error).length;
    const failedPosts = results.filter(r => r.status === 'rejected');
    const ok = results.length - failedPosts.length;
    const [one, many] = this.seriesNoun();
    const seriesText = this.single() ? '' : ` de ${ok} ${ok === 1 ? one : many}`;
    if (queued > 0) this.toast.success(`En cola: ${queued} ${queued === 1 ? 'publicación' : 'publicaciones'}${seriesText}. El progreso se ve en vivo.`);
    const problems = [...new Set(rows.filter(r => r.error).map(r => `${r.accountName}: ${r.error}`))];
    if (failedPosts.length) problems.unshift(apiError((failedPosts[0] as PromiseRejectedResult).reason, 'No se pudo encolar la publicación.'));
    if (problems.length) this.toast.warning(problems.slice(0, 3).join(' · ') + (problems.length > 3 ? ` · y ${problems.length - 3} más` : ''));
  }

  /** Los adjuntos de la plantilla solo se cargan si la publicación aún no tiene medios; si no, se usa solo el texto y se avisa. */
  private applyTemplate(template: ITemplate, byUser: boolean): void {
    this.templateId.set(template.id);
    this.title.set(template.title || '{titulo}');
    this.description.set(template.body ?? '');
    this.templateTags.set(template.tags ?? '');
    for (const a of this.chosen()) if (a.platform === 'YOUTUBE') this.patch(a.id, { tags: template.tags ?? '' });
    this.templateNotice.set(this.applyTemplateMedia(template));
    if (byUser) this.dirty.set(true);
  }

  private applyTemplateMedia(template: ITemplate): string | null {
    const media = usableTemplateMedia(template);
    const missing = template.media.length - media.length;
    const missingText = missing ? ` ${missing === 1 ? 'Un archivo ya no está' : `${missing} archivos ya no están`} en la biblioteca y se omite.` : '';
    if (!media.length) return missing ? missingText.trim() : null;
    const count = media.length === 1 ? 'un archivo' : `${media.length} archivos`;
    if (!this.single() || this.media().length) return `La plantilla trae ${count}, pero esta publicación ya tiene sus medios: se usa solo el texto.${missingText}`;
    this.media.set(media);
    return `Se cargaron ${count} de la plantilla. Puedes quitarlos, añadir más o cambiar el orden: la plantilla no cambia.${missingText}`;
  }

  private initialDraft(): IDraft {
    const schedule = this.schedule();
    return { ...newDraft(), tags: this.templateTags(), publishAt: schedule ? toLocalInput(schedule.start) : '' };
  }

  private select(id: number): void {
    this.selected.set(new Set(this.selected()).add(id));
    this.activeId.set(id);
    this.prepare(id);
  }

  /** Primera vez que se marca una cuenta: carga categorías de YouTube o creator_info de TikTok. */
  private prepare(id: number): void {
    const account = this.accounts().find(a => a.id === id)!;
    if (!this.drafts()[id]) this.patch(id, {});
    if (account.platform === 'YOUTUBE') {
      if (!this.categoriesRequested) this.loadCategories();
      else if (!this.draft(id).categoryId && this.categories().some(c => c.id === YOUTUBE_DEFAULT_CATEGORY)) this.patch(id, { categoryId: YOUTUBE_DEFAULT_CATEGORY });
    }
    if (account.platform === 'TIKTOK' && !this.tiktokInfo()[id]) this.loadTiktok(id);
  }

  private loadCategories(): void {
    this.categoriesRequested = true;
    void firstValueFrom(this.connectionsHttp.youtubeCategories())
      .then(list => {
        this.categories.set(list);
        if (!list.some(c => c.id === YOUTUBE_DEFAULT_CATEGORY)) return;
        for (const a of this.accounts()) if (a.platform === 'YOUTUBE' && !this.draft(a.id).categoryId) this.patch(a.id, { categoryId: YOUTUBE_DEFAULT_CATEGORY });
      })
      .catch(() => {
        this.categoriesRequested = false;
        this.toast.warning('No se pudieron cargar las categorías de YouTube.');
      });
  }
}
