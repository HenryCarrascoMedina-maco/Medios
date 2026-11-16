import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PLATFORM_META } from '@core/constants/status.constants';
import { ConnectionHttp, InboxHttp, TemplateHttp, VideoHttp } from '@core/http/api.http';
import { IConnection, IInboxRules, ITemplate, IVideo, InboxKind, Platform, TemplateUsage } from '@core/models/api.models';
import { ConfirmService } from '@core/services/confirm.service';
import { RulesService } from '@core/services/rules.service';
import { TemplateStoreService } from '@core/services/template-store.service';
import { ToastService } from '@core/services/toast.service';
import { VideoUploadService, isActiveUpload } from '@core/services/video-upload.service';
import { apiError } from '@core/utils/format';
import { inboxCapability } from '@core/utils/inbox';
import { inferPostKind } from '@core/utils/post-kind';
import { postBlockers } from '@core/utils/publication-rules';
import { resolveTemplate, templateFields, templateProblems } from '@core/utils/template-vars';
import { templateMediaVideo } from '@core/utils/templates';
import { MediaPickerDialog } from '@shared/publish/media-picker.dialog';
import { MediaStripComponent } from '@shared/publish/media-strip.component';
import { PublishPreviewComponent } from '@shared/publish/publish-preview.component';
import { IMediaItem, draftCounters, newDraft } from '@shared/publish/publish.models';
import { CheckboxComponent } from '@shared/ui/checkbox.component';
import { IconComponent } from '@shared/ui/icon.component';
import { PlatformBadgeComponent } from '@shared/ui/platform-badge.component';
import { ReqComponent } from '@shared/ui/req.component';
import { TemplateEditorComponent } from '@shared/ui/template-editor.component';

/** Un adjunto en el editor: `missing` = se borró de la biblioteca (se conserva hasta que se quite). */
interface IEditMedia extends IMediaItem {
  missing: boolean;
}

interface IForm {
  usage: TemplateUsage;
  name: string;
  shortcut: string;
  title: string;
  body: string;
  tags: string;
  platforms: Platform[];
  isDefault: boolean;
  media: IEditMedia[];
}

type CheckTone = 'ok' | 'info' | 'warn' | 'error';

const SHORTCUT = /^[a-z0-9áéíóúñü_-]{1,40}$/;
const MEDIA_MAX = 10;
/** Ejemplo de la vista previa. */
const SAMPLE = { title: 'Cómo preparar el pedido en 5 minutos', contact: 'María López' };
/** Tipos de conversación de la bandeja que se revisan para una respuesta. */
const REPLY_KINDS: readonly InboxKind[] = ['DIRECT', 'COMMENTS', 'GROUP'];
const KIND_LABEL: Record<InboxKind, string> = { DIRECT: 'privados', COMMENTS: 'comentarios', GROUP: 'grupos' };

/**
 * Ajustes › Plantillas › editar: nombre, uso (publicar o responder), texto con etiquetas, adjuntos de la biblioteca,
 * redes donde se ofrece, vista previa con un ejemplo y revisión. Avisa antes de salir con cambios sin guardar.
 */
@Component({
  selector: 'ym-template-edit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, CheckboxComponent, IconComponent, MediaPickerDialog, MediaStripComponent, PlatformBadgeComponent, PublishPreviewComponent,
    ReqComponent, TemplateEditorComponent
  ],
  templateUrl: './template-edit.page.html'
})
export class TemplateEditPage implements OnInit {
  private readonly http = inject(TemplateHttp);
  private readonly connectionsHttp = inject(ConnectionHttp);
  private readonly inboxHttp = inject(InboxHttp);
  private readonly videosHttp = inject(VideoHttp);
  private readonly uploader = inject(VideoUploadService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly rulesService = inject(RulesService);
  protected readonly store = inject(TemplateStoreService);

  protected readonly meta = PLATFORM_META;
  protected readonly mediaMax = MEDIA_MAX;

  protected readonly id = signal<number | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly picking = signal(false);
  protected readonly form = signal<IForm>(emptyForm('PUBLISH'));
  /** Lo guardado (o el formulario vacío): para saber si hay cambios sin guardar. */
  private readonly saved = signal('');
  protected readonly dirty = computed(() => this.snapshot(this.form()) !== this.saved());

  /** Cuentas conectadas: dan nombre, avatar y firma reales a la vista previa. */
  private readonly accounts = signal<IConnection[]>([]);
  private readonly inboxRules = signal<IInboxRules | null>(null);
  protected readonly previewPlatform = signal<Platform | null>(null);
  /** Archivos que se están subiendo desde aquí: al terminar se añaden a la plantilla. */
  private readonly pendingUploads = signal<ReadonlySet<string>>(new Set());
  protected readonly uploads = computed(() => this.uploader.uploads().filter(u => this.pendingUploads().has(u.fileName) && isActiveUpload(u)));

  protected readonly isReply = computed(() => this.form().usage === 'REPLY');
  /** Redes que se pueden marcar: las de publicar o las que tienen bandeja (sin TikTok). */
  protected readonly networks = computed<Platform[]>(() =>
    this.isReply() ? this.rulesService.inboxPlatforms() : this.rulesService.publishPlatforms());
  /** Redes de la vista previa: las marcadas o, si no hay, todas las disponibles. */
  protected readonly previewNetworks = computed(() => (this.form().platforms.length ? this.form().platforms : this.networks()));
  protected readonly activePreview = computed(() => {
    const list = this.previewNetworks();
    const chosen = this.previewPlatform();
    return chosen && list.includes(chosen) ? chosen : list[0] ?? null;
  });

  protected readonly hasMissing = computed(() => this.form().media.some(m => m.missing));
  protected readonly usableMedia = computed(() => this.form().media.filter(m => !m.missing).map(m => m.video));
  protected readonly kind = computed(() => inferPostKind(this.usableMedia()));
  protected readonly fields = computed(() => templateFields(this.form().title, this.form().body));

  /** Cuenta de ejemplo de la red: la conectada (★ primero) o una inventada. */
  protected readonly sampleAccount = computed<IConnection | null>(() => {
    const platform = this.activePreview();
    if (!platform) return null;
    const own = this.accounts().filter(a => a.platform === platform);
    return own.find(a => a.isDefault) ?? own[0] ?? fakeAccount(platform);
  });

  /** Texto con las etiquetas rellenas con el ejemplo (los campos muestran su nombre). */
  protected readonly preview = computed(() => {
    const f = this.form();
    const account = this.sampleAccount();
    const ctx = {
      title: SAMPLE.title, date: new Date(), signature: account?.signature, account: account ? account.alias ?? account.displayName : null,
      contact: SAMPLE.contact, blocks: this.store.blockMap(), fields: Object.fromEntries(this.fields().map(name => [name, `[${name}]`]))
    };
    return { title: resolveTemplate(f.title || '{titulo}', ctx), body: resolveTemplate(f.body, ctx) };
  });

  protected readonly counters = computed(() => {
    const platform = this.activePreview();
    if (!platform || this.isReply()) return null;
    const p = this.preview();
    return draftCounters(platform, { ...newDraft(), tags: this.form().tags }, {
      media: this.usableMedia(), kind: this.kind().kind ?? 'TEXT', title: p.title, description: p.body, madeForKids: false, synthetic: null, now: Date.now(),
      rules: this.rulesService.rules()
    });
  });

  /** Lo que impide guardar (el servidor lo vuelve a comprobar). */
  protected readonly errors = computed(() => {
    const f = this.form();
    const errors: string[] = [];
    if (!f.name.trim()) errors.push('Falta el nombre.');
    if (f.usage === 'REPLY' && !SHORTCUT.test(normalizeShortcut(f.shortcut))) errors.push('El atajo va sin espacios: letras, números, - o _.');
    if (!f.title.trim() && !f.body.trim() && !f.media.length) errors.push(f.usage === 'REPLY' ? 'Escribe el texto o adjunta un archivo.' : 'Escribe un título o un texto, o adjunta un archivo.');
    if (f.media.length > MEDIA_MAX) errors.push(`Como mucho ${MEDIA_MAX} archivos.`);
    return errors;
  });

  /** Revisión: etiquetas, campos, adjuntos y lo que cada red admite. */
  protected readonly checks = computed<{ tone: CheckTone; text: string }[]>(() => {
    const f = this.form();
    const options = { usage: f.usage, blocks: this.store.blockNames() };
    const problems = [...new Set([...templateProblems(f.usage === 'PUBLISH' ? f.title : '', options), ...templateProblems(f.body, options)])];
    const checks: { tone: CheckTone; text: string }[] = problems.length
      ? problems.map(text => ({ tone: 'warn' as const, text: `${text}: se usaría tal cual.` }))
      : [{ tone: 'ok', text: 'Todas las etiquetas existen.' }];
    const fields = this.fields();
    if (fields.length) checks.push({ tone: 'info', text: `${fields.length === 1 ? 'Se preguntará' : `Se preguntarán ${fields.length} datos`} al usarla: ${fields.join(', ')}.` });
    const missing = f.media.filter(m => m.missing).length;
    if (missing) checks.push({ tone: 'warn', text: `${missing === 1 ? 'Un archivo ya no está' : `${missing} archivos ya no están`} en la biblioteca: al usarla se omite. Quítalo para que no avise.` });
    return [...checks, ...(f.usage === 'REPLY' ? this.replyChecks() : this.publishChecks())];
  });

  ngOnInit(): void {
    void this.load();
    void firstValueFrom(this.connectionsHttp.status()).then(s => this.accounts.set(s.accounts)).catch(() => undefined);
    void firstValueFrom(this.inboxHttp.rules()).then(r => this.inboxRules.set(r)).catch(() => undefined);
    void this.rulesService.ensure();
    this.uploader.completed$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.attachUploaded());
  }

  /** Lo usa el guard de la ruta: con cambios sin guardar, pregunta antes de salir. */
  canLeave(): boolean | Promise<boolean> {
    if (!this.dirty() || this.saving()) return true;
    return this.confirm.ask({ title: 'Cambios sin guardar', message: 'Si sales ahora se pierden los cambios de esta plantilla.', confirmText: 'Salir sin guardar', danger: true });
  }

  protected patch(changes: Partial<IForm>): void {
    this.form.update(f => ({ ...f, ...changes }));
  }

  protected setUsage(usage: TemplateUsage): void {
    // Las redes de publicar y de la bandeja no son las mismas: se conservan solo las que valen.
    this.form.update(f => ({ ...f, usage, isDefault: usage === 'PUBLISH' && f.isDefault }));
    this.patch({ platforms: this.form().platforms.filter(p => this.networks().includes(p)) });
  }

  protected toggleNetwork(platform: Platform): void {
    const list = this.form().platforms;
    this.patch({ platforms: list.includes(platform) ? list.filter(p => p !== platform) : [...list, platform] });
  }

  protected setMedia(items: readonly IMediaItem[]): void {
    const missing = new Set(this.form().media.filter(m => m.missing).map(m => m.video.id));
    this.patch({ media: items.map(i => ({ ...i, missing: missing.has(i.video.id) })) });
  }

  protected addMedia(videos: IVideo[]): void {
    const present = new Set(this.form().media.map(m => m.video.id));
    this.patch({ media: [...this.form().media, ...videos.filter(v => !present.has(v.id)).map(video => ({ video, alt: '', missing: false }))] });
    this.picking.set(false);
  }

  protected removeMissing(): void {
    this.patch({ media: this.form().media.filter(m => !m.missing) });
  }

  /** Sube a la biblioteca (como en Medios) y, al terminar, lo añade a la plantilla. */
  protected upload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    this.pendingUploads.update(set => new Set([...set, ...files.map(f => f.name)]));
    this.uploader.add(files);
  }

  protected async save(): Promise<void> {
    if (this.errors().length || this.saving()) return;
    const f = this.form();
    this.saving.set(true);
    try {
      const id = await firstValueFrom(this.http.save({
        usage: f.usage, name: f.name.trim(), shortcut: f.usage === 'REPLY' ? normalizeShortcut(f.shortcut) : null,
        title: f.usage === 'PUBLISH' ? f.title : null, body: f.body, tags: f.usage === 'PUBLISH' ? f.tags : null, platforms: f.platforms,
        isDefault: f.usage === 'PUBLISH' && f.isDefault, media: f.media.map(m => ({ mediaId: m.video.id, alt: m.alt || null }))
      }, this.id()));
      await this.store.reload();
      this.saved.set(this.snapshot(f));
      this.toast.success(`Plantilla «${f.name.trim()}» guardada.`);
      if (this.id() !== id) void this.router.navigate(['/settings/templates', id], { replaceUrl: true });
      this.id.set(id);
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudo guardar la plantilla.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const id = this.id();
    if (!id || !(await this.confirm.ask({ title: `Borrar «${this.form().name}»`, message: 'No se puede deshacer.', confirmText: 'Borrar', danger: true }))) return;
    try {
      await firstValueFrom(this.http.delete(id));
      await this.store.reload();
      this.saved.set(this.snapshot(this.form()));
      this.toast.success('Plantilla borrada.');
      void this.router.navigate(['/settings/templates']);
    } catch (error) {
      this.toast.error(apiError(error));
    }
  }

  protected excluded(): number[] {
    return this.form().media.map(m => m.video.id);
  }

  private async load(): Promise<void> {
    const param = this.route.snapshot.paramMap.get('id');
    try {
      await this.store.ensure();
      if (param && param !== 'new') {
        const template = this.store.templates().find(t => t.id === Number(param)) ?? (await this.store.reload(), this.store.templates().find(t => t.id === Number(param)));
        if (!template) {
          this.toast.warning('La plantilla ya no existe.');
          void this.router.navigate(['/settings/templates']);
          return;
        }
        this.id.set(template.id);
        this.form.set(formOf(template));
      } else {
        const usage = this.route.snapshot.queryParamMap.get('uso') === 'REPLY' ? 'REPLY' : 'PUBLISH';
        this.form.set(emptyForm(usage));
      }
      this.saved.set(this.snapshot(this.form()));
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudieron cargar las plantillas.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** Tras una subida, busca en la biblioteca los archivos subidos desde aquí y los añade. */
  private async attachUploaded(): Promise<void> {
    const pending = this.pendingUploads();
    if (!pending.size) return;
    try {
      const page = await firstValueFrom(this.videosHttp.page({ sort: 'NEWEST', take: 20 }));
      const found = page.items.filter(v => pending.has(v.originalFileName));
      if (!found.length) return;
      this.addMedia(found);
      this.pendingUploads.update(set => new Set([...set].filter(name => !found.some(v => v.originalFileName === name))));
    } catch {
      // Si falla, el archivo ya está en la biblioteca: se puede añadir desde «Biblioteca».
    }
  }

  private publishChecks(): { tone: CheckTone; text: string }[] {
    const { kind, error } = this.kind();
    if (error) return [{ tone: 'error', text: `Adjuntos: ${error}.` }];
    if (!kind) return [];
    const rules = this.rulesService.rules();
    return this.previewNetworks().flatMap(platform =>
      postBlockers(platform, { kind, media: this.usableMedia() }, rules).map(text => ({ tone: 'warn' as const, text: `${PLATFORM_META[platform].label}: ${text}.` })));
  }

  private replyChecks(): { tone: CheckTone; text: string }[] {
    const rules = this.inboxRules();
    if (!rules) return [];
    const length = this.preview().body.length;
    const hasMedia = this.usableMedia().length > 0;
    return this.previewNetworks().flatMap(platform => REPLY_KINDS.flatMap((kind): { tone: CheckTone; text: string }[] => {
      const cap = inboxCapability(rules, platform, kind);
      if (!cap?.textMax) return [];
      const where = `${PLATFORM_META[platform].label} (${KIND_LABEL[kind]})`;
      if (length > cap.textMax) return [{ tone: 'warn' as const, text: `${where}: admite ${cap.textMax} caracteres y el texto tiene unos ${length}.` }];
      if (hasMedia && !cap.attachments) return [{ tone: 'info' as const, text: `${where}: no admite archivos; se envía solo el texto.` }];
      return [];
    }));
  }

  private snapshot(f: IForm): string {
    return JSON.stringify({ ...f, media: f.media.map(m => [m.video.id, m.alt]) });
  }
}

/** El atajo se guarda sin la «/» inicial y en minúsculas. */
function normalizeShortcut(shortcut: string): string {
  return shortcut.trim().replace(/^\//, '').toLowerCase();
}

function emptyForm(usage: TemplateUsage): IForm {
  return { usage, name: '', shortcut: '', title: usage === 'PUBLISH' ? '{titulo}' : '', body: '', tags: '', platforms: [], isDefault: false, media: [] };
}

function formOf(t: ITemplate): IForm {
  return {
    usage: t.usage, name: t.name, shortcut: t.shortcut ?? '', title: t.title ?? '', body: t.body ?? '', tags: t.tags ?? '', platforms: [...t.platforms],
    isDefault: t.isDefault, media: t.media.map(m => ({ video: templateMediaVideo(m), alt: m.altText ?? '', missing: m.missing }))
  };
}

/** Cuenta inventada para la vista previa cuando no hay ninguna conectada de esa red. */
function fakeAccount(platform: Platform): IConnection {
  return {
    id: 0, platform, externalId: '', displayName: 'Tu cuenta', alias: null, avatarUrl: null, accountHint: null, scopes: null, tokenExpiresAt: null,
    statusCode: 'CONNECTED', statusMessage: null, isDefault: false, credentialId: null, credentialName: null, signature: null, uploadLimitMb: null,
    connectedBy: '', connectedAt: '', lastUsedAt: null, lastTestAt: null, lastTestOk: null, lastTestMessage: null, revokedAt: null
  };
}
