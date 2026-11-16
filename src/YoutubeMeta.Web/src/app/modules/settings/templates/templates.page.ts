import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, from, map } from 'rxjs';
import { TemplateHttp } from '@core/http/api.http';
import { ITemplate, ITemplateSave } from '@core/models/api.models';
import { ConfirmService } from '@core/services/confirm.service';
import { TemplateStoreService } from '@core/services/template-store.service';
import { ToastService } from '@core/services/toast.service';
import { apiError } from '@core/utils/format';
import { createLoader } from '@core/utils/loader';
import { templateMediaVideo } from '@core/utils/templates';
import { createPublishLauncher } from '@shared/publish/publish-launcher';
import { PublishDialog } from '@shared/publish/publish.dialog';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { ChipComponent } from '@shared/ui/chip.component';
import { FilterChipsComponent, IFilterOption } from '@shared/ui/filter-chips.component';
import { IconComponent } from '@shared/ui/icon.component';
import { MediaThumbComponent } from '@shared/ui/media-thumb.component';
import { PlatformBadgeComponent } from '@shared/ui/platform-badge.component';
import { TemplateTextComponent } from '@shared/ui/template-text.component';
import { SettingsTabsComponent } from '../settings-tabs.component';
import { BlocksSectionComponent } from './blocks-section.component';

export type TemplatesView = '' | 'PUBLISH' | 'REPLY' | 'BLOCKS';
const VIEWS: readonly TemplatesView[] = ['', 'PUBLISH', 'REPLY', 'BLOCKS'];
/** Miniaturas que se ven en cada tarjeta (el resto, «+N»). */
const THUMBS = 4;

/**
 * Ajustes › Plantillas: una sola lista para las plantillas de publicación y las respuestas de la bandeja (/atajo), con
 * búsqueda, uso y avisos; los bloques de hashtags en su propia vista. Al pulsar una plantilla se abre el editor.
 */
@Component({
  selector: 'ym-templates-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, AsyncStateComponent, ChipComponent, FilterChipsComponent, IconComponent, MediaThumbComponent, PlatformBadgeComponent,
    PublishDialog, SettingsTabsComponent, TemplateTextComponent, BlocksSectionComponent
  ],
  templateUrl: './templates.page.html'
})
export class TemplatesPage implements OnInit {
  private readonly http = inject(TemplateHttp);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly store = inject(TemplateStoreService);
  protected readonly publish = createPublishLauncher();

  protected readonly thumbs = THUMBS;
  protected readonly toVideo = templateMediaVideo;
  protected readonly data = createLoader(() => from(this.store.reload()).pipe(map(() => true)), { errorMessage: 'No se pudieron cargar las plantillas.' });
  protected readonly view = signal<TemplatesView>('');
  protected readonly search = signal('');
  protected readonly busy = signal<number | null>(null);

  protected readonly views = computed<IFilterOption<TemplatesView>[]>(() => {
    const all = this.store.templates();
    return [
      { value: '', label: 'Todas', count: all.length },
      { value: 'PUBLISH', label: 'Publicaciones', count: this.store.publishTemplates().length },
      { value: 'REPLY', label: 'Respuestas', count: this.store.replies().length },
      { value: 'BLOCKS', label: 'Bloques #', count: this.store.blocks().length }
    ];
  });

  protected readonly visible = computed(() => {
    const view = this.view();
    const term = this.search().trim().toLowerCase();
    return this.store.templates().filter(t =>
      (!view || t.usage === view)
      && (!term || [t.name, t.shortcut, t.title, t.body].some(value => value?.toLowerCase().includes(term))));
  });

  ngOnInit(): void {
    const requested = this.route.snapshot.queryParamMap.get('ver') as TemplatesView | null;
    if (requested && VIEWS.includes(requested)) this.view.set(requested);
    this.data.reload();
  }

  protected setView(view: TemplatesView): void {
    this.view.set(view);
    void this.router.navigate([], { queryParams: { ver: view || null }, replaceUrl: true });
  }

  protected missingCount(t: ITemplate): number {
    return t.media.filter(m => m.missing).length;
  }

  protected openPublish(t: ITemplate): void {
    void this.publish.open([], null, { asPost: true, template: t });
  }

  protected async duplicate(t: ITemplate): Promise<void> {
    const name = this.copyName(t);
    await this.run(t.id, () => firstValueFrom(this.http.save({
      ...this.saveOf(t), name, isDefault: false, shortcut: t.shortcut ? this.copyShortcut(t.shortcut) : null
    })), `Copia «${name}» creada.`);
  }

  protected async makeDefault(t: ITemplate): Promise<void> {
    await this.run(t.id, () => firstValueFrom(this.http.save({ ...this.saveOf(t), isDefault: true }, t.id)), `«${t.name}» se aplica ahora al abrir Publicar.`);
  }

  protected async remove(t: ITemplate): Promise<void> {
    const what = t.usage === 'REPLY' ? `La respuesta /${t.shortcut} dejará de aparecer en la bandeja.` : 'Lo ya publicado no cambia.';
    if (await this.confirm.ask({ title: `Borrar «${t.name}»`, message: what, confirmText: 'Borrar', danger: true }))
      await this.run(t.id, () => firstValueFrom(this.http.delete(t.id)), 'Plantilla borrada.');
  }

  /** La plantilla tal cual para volver a guardarla (duplicar o marcar por defecto). */
  private saveOf(t: ITemplate): ITemplateSave {
    return {
      usage: t.usage, name: t.name, shortcut: t.shortcut, title: t.title, body: t.body, tags: t.tags, platforms: t.platforms, isDefault: t.isDefault,
      media: t.media.map(m => ({ mediaId: m.mediaId, alt: m.altText }))
    };
  }

  private copyName(t: ITemplate): string {
    const names = new Set(this.store.templates().filter(o => o.usage === t.usage).map(o => o.name));
    for (let i = 1; ; i++) {
      const name = `${t.name} (copia${i > 1 ? ` ${i}` : ''})`.slice(0, 100);
      if (!names.has(name)) return name;
    }
  }

  private copyShortcut(shortcut: string): string {
    const used = new Set(this.store.replies().map(r => r.shortcut));
    for (let i = 2; ; i++) {
      const candidate = `${shortcut.slice(0, 36)}-${i}`;
      if (!used.has(candidate)) return candidate;
    }
  }

  private async run(id: number, request: () => Promise<unknown>, success: string): Promise<void> {
    this.busy.set(id);
    try {
      await request();
      await this.store.reload();
      this.toast.success(success);
    } catch (error) {
      this.toast.error(apiError(error));
    } finally {
      this.busy.set(null);
    }
  }
}
