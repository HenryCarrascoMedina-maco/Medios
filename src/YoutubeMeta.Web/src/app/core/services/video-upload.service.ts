import { Injectable, NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subject, firstValueFrom } from 'rxjs';
import * as tus from 'tus-js-client';
import { VideoHttp } from '../http/api.http';
import { ITusConfig } from '../models/api.models';
import { SessionService } from '../session/session.service';
import { formatBytes } from '../utils/format';
import { mediaKindOfFile } from '../utils/post-kind';
import { IVideoProbe, probeImage, probeVideo } from '../utils/video-probe';
import { ToastService } from './toast.service';

export type UploadState = 'preparing' | 'uploading' | 'paused' | 'finalizing' | 'completed' | 'error';

export interface IUploadItem {
  key: string;
  fileName: string;
  size: number;
  loaded: number;
  state: UploadState;
  message: string | null;
  bytesPerSecond: number | null;
  canResume: boolean;
  /** En pausa porque la sesión caducó: se reanuda sola al volver a entrar. */
  awaitingAuth: boolean;
}

/** Partes de 10 MB y reintentos ante cortes (~68 s), igual que Multimedia en Sinsatools. */
const CHUNK_SIZE = 10 * 1024 * 1024;
const RETRY_DELAYS = [0, 3000, 5000, 10000, 20000, 30000];
const EXPIRED_STATUSES = [404, 410];
const COMPLETED_LINGER_MS = 4000;
const AUTH_PAUSED: Partial<IUploadItem> = { state: 'paused', awaitingAuth: true, canResume: false, message: 'Sesión caducada: continúa sola al volver a entrar.', bytesPerSecond: null };

interface IUploadHandle {
  upload: tus.Upload;
  file: File;
}

export function uploadPercent(item: Pick<IUploadItem, 'loaded' | 'size'>): number {
  return item.size > 0 ? Math.floor((item.loaded / item.size) * 100) : 0;
}

/** Subidas que siguen vivas (no terminadas ni con error). */
export function isActiveUpload(item: IUploadItem): boolean {
  return item.state === 'preparing' || item.state === 'uploading' || item.state === 'finalizing' || (item.state === 'paused' && item.awaitingAuth);
}

/**
 * Subidas TUS de la biblioteca. Si la red se corta, tus-js-client reintenta solo; si la página se
 * recarga, al volver a elegir el MISMO archivo la subida continúa desde el último byte que el
 * servidor confirmó (huella guardada en localStorage). Si la sesión caduca, las subidas se pausan
 * y continúan solas al volver a entrar.
 */
@Injectable({ providedIn: 'root' })
export class VideoUploadService {
  private readonly videos = inject(VideoHttp);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly zone = inject(NgZone);

  private readonly items = signal<IUploadItem[]>([]);
  private readonly handles = new Map<string, IUploadHandle>();
  /** Una por subida mientras se prepara: cancelar la marca y begin() se detiene tras cada await. */
  private readonly aborts = new Map<string, AbortController>();
  private readonly speedSamples = new Map<string, { at: number; loaded: number }>();
  private readonly completedSubject = new Subject<void>();
  private config: Promise<ITusConfig> | null = null;

  readonly uploads = this.items.asReadonly();
  readonly busy = computed(() => this.items().some(i => i.state === 'preparing' || i.state === 'uploading' || i.state === 'finalizing'));
  readonly active = computed(() => this.items().filter(isActiveUpload));
  readonly completed$ = this.completedSubject.asObservable();

  constructor() {
    // La sesión deja de valer (caducó, 401 o salir): pausa ordenada. Vuelve a valer (renovación,
    // reautenticación o login nuevo): continúan solas.
    effect(() => {
      const authenticated = this.session.isAuthenticated();
      untracked(() => (authenticated ? this.resumeAfterAuth() : this.pauseForAuth()));
    });

    window.addEventListener('beforeunload', event => {
      if (!this.busy()) return;
      event.preventDefault();
      // Chrome/Edge antiguos solo muestran el aviso si returnValue tiene valor.
      event.returnValue = '';
    });
  }

  add(files: Iterable<File>): void {
    for (const file of files) void this.begin(file);
  }

  pause(key: string): void {
    const handle = this.handles.get(key);
    if (!handle) return;
    void handle.upload.abort(false);
    this.patch(key, { state: 'paused', message: 'En pausa', bytesPerSecond: null });
  }

  resume(key: string): void {
    const handle = this.handles.get(key);
    if (!handle) return;
    this.patch(key, { state: 'uploading', message: null, canResume: false, awaitingAuth: false });
    handle.upload.start();
  }

  /** Corta la subida (también si aún se está preparando), la borra en el servidor (DELETE) y olvida su huella. */
  async cancel(key: string): Promise<void> {
    this.aborts.get(key)?.abort();
    const handle = this.handles.get(key);
    this.remove(key);
    if (!handle) return;
    try {
      await handle.upload.abort(true);
    } catch {
      // Si el DELETE no llega, el servidor la caduca solo.
    }
    await this.forget(handle.file);
  }

  dismiss(key: string): void {
    this.remove(key);
  }

  private pauseForAuth(): void {
    for (const item of this.items()) {
      if (item.state !== 'uploading') continue;
      void this.handles.get(item.key)?.upload.abort(false);
      this.patch(item.key, AUTH_PAUSED);
    }
  }

  private resumeAfterAuth(): void {
    for (const item of this.items()) if (item.awaitingAuth) this.resume(item.key);
  }

  private async begin(file: File): Promise<void> {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const abort = new AbortController();
    const cancelled = () => abort.signal.aborted;
    this.aborts.set(key, abort);
    this.items.update(list => [...list, { key, fileName: file.name, size: file.size, loaded: 0, state: 'preparing', message: 'Preparando…', bytesPerSecond: null, canResume: false, awaitingAuth: false }]);

    let config: ITusConfig;
    try {
      config = await this.loadConfig();
    } catch {
      if (!cancelled()) this.patch(key, { state: 'error', message: 'No se pudo leer la configuración de subida del servidor.' });
      return;
    }
    if (cancelled()) return;

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!config.allowedExtensions.includes(extension)) {
      this.patch(key, { state: 'error', message: `Formato no admitido. Se aceptan: ${config.allowedExtensions.join(', ')}.` });
      return;
    }
    if (file.size > config.maxUploadBytes) {
      this.patch(key, { state: 'error', message: `Supera el máximo de ${formatBytes(config.maxUploadBytes)}.` });
      return;
    }

    const previous = await this.findPrevious(file);
    if (cancelled()) return;
    // Una subida retomada ya tiene sus metadatos en el servidor: no hace falta volver a analizar el video.
    const metadata = previous ? { fileName: file.name } : await this.buildMetadata(file, key, abort.signal);
    if (cancelled()) return;

    const upload: tus.Upload = new tus.Upload(file, {
      endpoint: this.videos.tusEndpoint,
      chunkSize: CHUNK_SIZE,
      retryDelays: RETRY_DELAYS,
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      metadata,
      fingerprint: () => Promise.resolve(fingerprintOf(file)),
      // El token se lee en cada petición: una subida larga usa siempre el vigente.
      onBeforeRequest: request => request.setHeader('Authorization', `Bearer ${this.session.getToken() ?? ''}`),
      onUploadUrlAvailable: () => {
        if (upload.url) upload.url = this.tusUrl(upload.url);
      },
      onProgress: (loaded, total) => this.zone.run(() => this.progress(key, loaded, total)),
      onSuccess: () => this.zone.run(() => this.succeed(key, file.name)),
      onError: error => this.zone.run(() => void this.fail(key, file, error))
    });

    this.handles.set(key, { upload, file });
    this.aborts.delete(key);
    if (previous?.uploadUrl) {
      upload.resumeFromPreviousUpload({ ...previous, uploadUrl: this.tusUrl(previous.uploadUrl) });
      this.patch(key, { message: 'Retomando la subida anterior…' });
    }
    if (!this.session.isAuthenticated()) {
      this.patch(key, AUTH_PAUSED);
      return;
    }
    this.patch(key, { state: 'uploading' });
    upload.start();
  }

  /**
   * Metadatos TUS según el tipo: los videos llevan duración, tamaño y un fotograma de miniatura; las
   * imágenes, su tamaño y una miniatura JPEG; los PDF, nada más que el nombre (no se analizan).
   */
  private async buildMetadata(file: File, key: string, signal: AbortSignal): Promise<Record<string, string>> {
    const kind = mediaKindOfFile(file.name);
    if (kind !== 'DOCUMENT') this.patch(key, { message: kind === 'VIDEO' ? 'Leyendo duración y miniatura…' : 'Leyendo la imagen…' });
    const probe: IVideoProbe = kind === 'VIDEO' ? await probeVideo(file) : kind === 'IMAGE' ? await probeImage(file) : {};

    let posterId = '';
    if (probe.poster && !signal.aborted) {
      try {
        posterId = await firstValueFrom(this.videos.uploadPoster(probe.poster));
      } catch {
        // Sin miniatura la subida sigue igual.
      }
    }

    return {
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(),
      durationSec: kind === 'VIDEO' && probe.durationSec != null ? String(probe.durationSec) : '',
      width: probe.width != null ? String(probe.width) : '',
      height: probe.height != null ? String(probe.height) : '',
      posterId
    };
  }

  private progress(key: string, loaded: number, total: number): void {
    const item = this.items().find(i => i.key === key);
    // Tras pausar, tus-js-client aún puede avisar de un trozo en vuelo: no debe volver a «Subiendo».
    if (!item || item.state === 'paused' || item.state === 'error') return;

    const now = performance.now();
    const sample = this.speedSamples.get(key);
    let bytesPerSecond = item.bytesPerSecond;
    if (sample && now > sample.at) {
      const instant = ((loaded - sample.loaded) * 1000) / (now - sample.at);
      bytesPerSecond = bytesPerSecond == null ? instant : bytesPerSecond * 0.7 + instant * 0.3;
    }
    this.speedSamples.set(key, { at: now, loaded });

    const finished = total > 0 && loaded >= total;
    this.patch(key, {
      loaded,
      state: finished ? 'finalizing' : 'uploading',
      message: finished ? 'Registrando el archivo…' : null,
      bytesPerSecond: finished ? null : bytesPerSecond
    });
  }

  private succeed(key: string, fileName: string): void {
    this.handles.delete(key);
    this.patch(key, { state: 'completed', loaded: this.items().find(i => i.key === key)?.size ?? 0, message: 'Completado', bytesPerSecond: null });
    this.toast.success(`«${fileName}» se subió correctamente.`);
    this.completedSubject.next();
    setTimeout(() => this.remove(key), COMPLETED_LINGER_MS);
  }

  /**
   * Una sesión caducada en el servidor no se puede retomar: se olvida su huella para empezar de cero.
   * Un 401 no ofrece «Reanudar» (volvería a fallar): se pide la contraseña y continúa sola.
   */
  private async fail(key: string, file: File, error: Error | tus.DetailedError): Promise<void> {
    const status = (error as tus.DetailedError).originalResponse?.getStatus() ?? 0;
    if (status === 401) {
      this.patch(key, AUTH_PAUSED);
      this.session.markUnauthorized();
      return;
    }
    if (EXPIRED_STATUSES.includes(status)) {
      this.handles.delete(key);
      await this.forget(file);
      this.patch(key, { state: 'error', message: 'La subida caducó en el servidor. Vuelve a elegir el archivo para empezar de cero.', bytesPerSecond: null });
      return;
    }

    const body = (error as tus.DetailedError).originalResponse?.getBody();
    const message = body && body.length < 300 ? body : 'Se perdió la conexión. Reanuda para continuar desde donde iba.';
    this.patch(key, { state: 'error', message, bytesPerSecond: null, canResume: true });
  }

  private async findPrevious(file: File): Promise<tus.PreviousUpload | null> {
    try {
      const previous = await tus.defaultOptions.urlStorage.findUploadsByFingerprint(fingerprintOf(file));
      return [...previous].sort((a, b) => b.creationTime.localeCompare(a.creationTime))[0] ?? null;
    } catch {
      return null;
    }
  }

  private async forget(file: File): Promise<void> {
    try {
      const storage = tus.defaultOptions.urlStorage;
      const previous = await storage.findUploadsByFingerprint(fingerprintOf(file));
      await Promise.all(previous.map(p => storage.removeUpload(p.urlStorageKey)));
    } catch {
      // Sin almacenamiento local no hay huellas que borrar.
    }
  }

  private loadConfig(): Promise<ITusConfig> {
    this.config ??= firstValueFrom(this.videos.tusConfig()).catch(error => {
      this.config = null;
      throw error;
    });
    return this.config;
  }

  private tusUrl(url: string): string {
    return `${this.videos.tusEndpoint}/${url.split('/').pop()}`;
  }

  private patch(key: string, changes: Partial<IUploadItem>): void {
    this.items.update(list => list.map(item => (item.key === key ? { ...item, ...changes } : item)));
  }

  private remove(key: string): void {
    this.handles.delete(key);
    this.aborts.delete(key);
    this.speedSamples.delete(key);
    this.items.update(list => list.filter(item => item.key !== key));
  }
}

function fingerprintOf(file: File): string {
  return ['ym-video', file.name, file.size, file.lastModified].join('-');
}
