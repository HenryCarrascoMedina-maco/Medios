import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, filter, firstValueFrom, forkJoin, merge } from 'rxjs';
import { ConnectionHttp, PublicationHttp, VideoHttp } from '@core/http/api.http';
import { LIVE_STATUSES, PLATFORMS, PLATFORM_META, PRIVACY_LABEL } from '@core/constants/status.constants';
import { RulesService } from '@core/services/rules.service';
import { IPublication, IPublicationEvent, Platform } from '@core/models/api.models';
import { ConfirmService } from '@core/services/confirm.service';
import { TemplateStoreService } from '@core/services/template-store.service';
import { EntityHubService } from '@core/services/entity-hub.service';
import { PosterService } from '@core/services/poster.service';
import { PublicationActionsService } from '@core/services/publication-actions.service';
import { TagStoreService } from '@core/services/tag-store.service';
import { ToastService } from '@core/services/toast.service';
import { apiError, formatBytes, formatDuration, isShort } from '@core/utils/format';
import { createLoader } from '@core/utils/loader';
import { canCancel, canRetry, withProgress } from '@core/utils/publication-actions';
import { mediaKindOf } from '@core/utils/post-kind';
import { YOUTUBE_UNVERIFIED_MAX_SECONDS } from '@core/utils/publication-rules';
import { PublishDialog } from '@shared/publish/publish.dialog';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { ChipComponent } from '@shared/ui/chip.component';
import { MediaThumbComponent } from '@shared/ui/media-thumb.component';
import { IconComponent } from '@shared/ui/icon.component';
import { PublicationMetricsComponent } from '@shared/ui/publication-metrics.component';
import { PublicationNotesComponent } from '@shared/ui/publication-notes.component';
import { PublicationProgressComponent } from '@shared/ui/publication-progress.component';
import { PublicationResolveComponent } from '@shared/ui/publication-resolve.component';
import { TagEditorComponent } from '@shared/ui/tag-editor.component';
import { StatusChipComponent } from '@shared/ui/status-chip.component';
import { VideoPlayerComponent } from '@shared/video-player.component';

const POSTER_MAX_BYTES = 2 * 1024 * 1024;

/** Una tarjeta por cuenta: las conectadas y las ya quitadas que tienen publicaciones de este video. */
interface IAccountPanel {
  connectionId: number;
  platform: Platform;
  name: string;
  avatarUrl: string | null;
  connected: boolean;
  removed: boolean;
  publication: IPublication | null;
  events: IPublicationEvent[];
  canPublish: boolean;
  canRetry: boolean;
  canCancel: boolean;
}

@Component({
  selector: 'ym-video-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, RouterLink, StatusChipComponent, VideoPlayerComponent, PublishDialog, AccountAvatarComponent, AsyncStateComponent,
    ChipComponent, MediaThumbComponent, IconComponent, PublicationNotesComponent, PublicationProgressComponent, PublicationResolveComponent, TagEditorComponent, PublicationMetricsComponent
  ],
  templateUrl: './video-detail.page.html'
})
export class VideoDetailPage implements OnInit {
  private readonly videosHttp = inject(VideoHttp);
  private readonly publicationsHttp = inject(PublicationHttp);
  private readonly connectionsHttp = inject(ConnectionHttp);
  private readonly rules = inject(RulesService);
  private readonly hub = inject(EntityHubService);
  private readonly posters = inject(PosterService);
  private readonly confirm = inject(ConfirmService);
  private readonly templates = inject(TemplateStoreService);
  private readonly actions = inject(PublicationActionsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly tagStore = inject(TagStoreService);
  private readonly player = viewChild(VideoPlayerComponent);

  /** Parámetro de ruta :id (withComponentInputBinding). Cambia sin recrear la página al abrir otro video. */
  readonly id = input.required<string>();

  protected readonly videoId = computed(() => Number(this.id()));
  private readonly videoId$ = toObservable(this.videoId);
  protected readonly video = createLoader(() => this.videosHttp.get(this.videoId()), {
    errorMessage: 'No se pudo cargar el video.',
    describeError: (error, fallback) => (error instanceof HttpErrorResponse && error.status === 404 ? 'El video no existe o fue eliminado.' : apiError(error, fallback))
  });
  /** Video, imagen o PDF: solo los videos tienen reproductor, duración y fotograma de miniatura. */
  protected readonly kind = computed(() => mediaKindOf(this.video.value()));
  protected readonly data = createLoader(
    () => forkJoin({
      publications: this.publicationsHttp.list({ videoId: this.videoId() }),
      events: this.publicationsHttp.events(this.videoId()),
      status: this.connectionsHttp.status()
    }),
    { errorMessage: 'No se pudieron cargar las publicaciones del video.' }
  );

  /** null = cerrado; [] = preselección por defecto; [ids] = esas cuentas marcadas. */
  protected readonly dialog = signal<number[] | null>(null);
  protected readonly editingTitle = signal(false);
  protected readonly titleDraft = signal('');
  protected readonly posterBusy = signal(false);
  /** El diálogo de publicación recibe una lista (aquí, un solo video). */
  protected readonly dialogVideos = computed(() => {
    const video = this.video.value();
    return video ? [video] : [];
  });

  protected readonly accounts = computed(() => this.data.value()?.status.accounts ?? []);
  protected readonly meta = PLATFORM_META;
  protected readonly privacyLabel = PRIVACY_LABEL;
  protected readonly formatBytes = formatBytes;
  protected readonly formatDuration = formatDuration;
  protected readonly longLimit = YOUTUBE_UNVERIFIED_MAX_SECONDS;
  protected readonly short = computed(() => {
    const v = this.video.value();
    return v != null && isShort(v.width, v.height, v.durationSec);
  });

  protected readonly panels = computed<IAccountPanel[]>(() => {
    const data = this.data.value();
    if (!data) return [];
    const latest = new Map<number, IPublication>();
    for (const p of data.publications) if (!latest.has(p.connectionId)) latest.set(p.connectionId, p);

    const publishable = new Set(this.rules.publishPlatforms());
    const accounts = data.status.accounts.filter(a => publishable.has(a.platform));
    const panels = accounts.map(a => this.panel(a.id, a.platform, a.alias ?? a.displayName, a.avatarUrl, a.statusCode === 'CONNECTED', false, latest.get(a.id) ?? null, data.events));
    for (const [connectionId, p] of latest) {
      if (!accounts.some(a => a.id === connectionId)) panels.push(this.panel(connectionId, p.target, p.connectionName, p.connectionAvatarUrl, false, true, p, data.events));
    }
    return panels.sort((x, y) => PLATFORMS.indexOf(x.platform) - PLATFORMS.indexOf(y.platform));
  });

  ngOnInit(): void {
    this.tagStore.refresh();
    // Cambio de :id (p. ej. un aviso de otro video): se olvida lo anterior y se carga el nuevo.
    this.videoId$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.dialog.set(null);
        this.editingTitle.set(false);
        this.video.reset();
        this.data.reset();
      });

    const mine = this.hub.publishUpdates().pipe(filter(u => u.videoId === this.videoId()));
    mine.pipe(filter(u => !u.isFinal), takeUntilDestroyed(this.destroyRef))
      .subscribe(u => this.data.value.update(d => d && {
        ...d,
        publications: withProgress(d.publications, u)
      }));

    merge(mine.pipe(filter(u => u.isFinal)), this.hub.on('Connection'), this.hub.reconnected$)
      .pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.data.reload());
  }

  protected openPublish(connectionIds: number[] = []): void {
    if (this.accounts().length === 0) {
      this.toast.warning('Primero conecta al menos una cuenta en Conexiones.');
      void this.router.navigate(['/connections']);
      return;
    }
    this.dialog.set(connectionIds);
  }

  protected onPublished(): void {
    this.dialog.set(null);
    this.data.reload();
  }

  protected async retry(publication: IPublication): Promise<void> {
    if (await this.actions.retry(publication)) this.data.reload();
  }

  protected async cancel(publication: IPublication): Promise<void> {
    if (await this.actions.cancel(publication)) this.data.reload();
  }

  protected async saveTags(tags: string[]): Promise<void> {
    const video = this.video.value();
    if (!video) return;
    const before = video.tags ?? [];
    this.video.value.set({ ...video, tags });
    try {
      await this.tagStore.setTags(video.id, before, tags);
    } catch (error) {
      this.video.value.set({ ...video, tags: before });
      this.toast.error(apiError(error, 'No se pudieron guardar las etiquetas.'));
    }
  }

  protected async useCurrentFrame(): Promise<void> {
    const frame = await this.player()?.captureCurrentFrame();
    if (!frame) {
      this.toast.warning('Aún no hay imagen en el reproductor: dale a reproducir o busca el momento y vuelve a intentarlo.');
      return;
    }
    await this.uploadPoster(frame);
  }

  protected async onPosterFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.type !== 'image/jpeg') return this.toast.warning('La miniatura debe ser un JPEG.');
    if (file.size > POSTER_MAX_BYTES) return this.toast.warning('La miniatura no puede pasar de 2 MB.');
    await this.uploadPoster(file);
  }

  private async uploadPoster(blob: Blob): Promise<void> {
    const id = this.videoId();
    this.posterBusy.set(true);
    try {
      this.video.value.set(await firstValueFrom(this.videosHttp.replacePoster(id, blob)));
      this.posters.refresh(id);
      this.toast.success('Miniatura actualizada.');
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudo cambiar la miniatura.'));
    } finally {
      this.posterBusy.set(false);
    }
  }

  protected startEditTitle(): void {
    this.titleDraft.set(this.video.value()?.title ?? '');
    this.editingTitle.set(true);
  }

  protected async saveTitle(): Promise<void> {
    try {
      this.video.value.set(await firstValueFrom(this.videosHttp.updateTitle(this.videoId(), this.titleDraft().trim())));
      this.editingTitle.set(false);
    } catch (error) {
      this.toast.error(apiError(error));
    }
  }

  protected async deleteVideo(): Promise<void> {
    const video = this.video.value();
    if (!video) return;
    const accepted = await this.confirm.ask({
      title: 'Eliminar video',
      message: `Se borrará «${video.title}» del almacenamiento. Lo ya publicado en las plataformas no se toca.${await this.templates.mediaUsageNote([video.id])}`,
      confirmText: 'Eliminar',
      danger: true
    });
    if (!accepted) return;
    try {
      await firstValueFrom(this.videosHttp.delete(video.id));
      this.posters.forget(video.id);
      this.toast.success('Video eliminado.');
      await this.router.navigate(['/library']);
    } catch (error) {
      this.toast.error(apiError(error));
    }
  }

  private panel(connectionId: number, platform: Platform, name: string, avatarUrl: string | null, connected: boolean, removed: boolean,
                publication: IPublication | null, events: IPublicationEvent[]): IAccountPanel {
    const live = publication != null && LIVE_STATUSES.includes(publication.statusCode);
    return {
      connectionId,
      platform,
      name,
      avatarUrl,
      connected,
      removed,
      publication,
      events: publication ? events.filter(e => e.publicationId === publication.id) : [],
      canPublish: !removed && !live,
      canRetry: canRetry(publication),
      canCancel: canCancel(publication)
    };
  }
}
