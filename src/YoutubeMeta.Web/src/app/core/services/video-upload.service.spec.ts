import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import * as tus from 'tus-js-client';
import { VideoHttp } from '../http/api.http';
import { ITusConfig } from '../models/api.models';
import { SessionService } from '../session/session.service';
import { VideoUploadService } from './video-upload.service';

interface IFakeUpload {
  options: tus.UploadOptions;
  start: jest.Mock;
  abort: jest.Mock;
  resumeFromPreviousUpload: jest.Mock;
  url: string | null;
}

const uploads: IFakeUpload[] = [];

jest.mock('tus-js-client', () => ({
  Upload: jest.fn().mockImplementation((_file: File, options: tus.UploadOptions) => {
    const upload: IFakeUpload = { options, start: jest.fn(), abort: jest.fn().mockResolvedValue(undefined), resumeFromPreviousUpload: jest.fn(), url: null };
    uploads.push(upload);
    return upload;
  }),
  defaultOptions: {
    urlStorage: {
      findUploadsByFingerprint: jest.fn().mockResolvedValue([]),
      removeUpload: jest.fn().mockResolvedValue(undefined)
    }
  }
}));

jest.mock('../utils/video-probe', () => ({ probeVideo: jest.fn().mockResolvedValue({ durationSec: 10, width: 1920, height: 1080 }) }));

const CONFIG: ITusConfig = { ttlMinutes: 60, maxUploadBytes: 1024 ** 3, allowedExtensions: ['mp4'] };

/** Deja correr las promesas pendientes (los await encadenados de begin()). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('VideoUploadService', () => {
  let service: VideoUploadService;
  let config$: Subject<ITusConfig>;
  const authenticated = signal(true);
  // Como el SessionService real: un 401 deja la sesión sin validez.
  const session = { isAuthenticated: authenticated, getToken: () => 'tok', markUnauthorized: jest.fn(() => authenticated.set(false)) };

  beforeEach(() => {
    uploads.length = 0;
    authenticated.set(true);
    config$ = new Subject<ITusConfig>();
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionService, useValue: session },
        {
          provide: VideoHttp,
          useValue: { tusEndpoint: '/api/Video/tus', tusConfig: () => config$, uploadPoster: jest.fn(() => of('poster-1')) }
        }
      ]
    });
    service = TestBed.inject(VideoUploadService);
    TestBed.flushEffects();
  });

  afterEach(() => TestBed.resetTestingModule());

  const file = (name = 'video.mp4') => new File(['x'.repeat(100)], name, { type: 'video/mp4', lastModified: 1 });

  it('cancelar mientras «prepara» no crea ninguna subida (sin subida fantasma)', async () => {
    service.add([file()]);
    const [item] = service.uploads();
    expect(item.state).toBe('preparing');

    await service.cancel(item.key);
    expect(service.uploads()).toHaveLength(0);

    // La configuración llega después de cancelar: begin() debe detenerse.
    config$.next(CONFIG);
    config$.complete();
    await flush();

    expect(tus.Upload).not.toHaveBeenCalled();
    expect(service.uploads()).toHaveLength(0);
  });

  it('cancelar durante la lectura del video (tras la configuración) tampoco sube', async () => {
    service.add([file()]);
    const [item] = service.uploads();
    config$.next(CONFIG);
    config$.complete();
    await Promise.resolve();
    await service.cancel(item.key);
    await flush();
    expect(tus.Upload).not.toHaveBeenCalled();
  });

  it('sin cancelar, prepara y empieza la subida', async () => {
    service.add([file()]);
    config$.next(CONFIG);
    config$.complete();
    await flush();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].start).toHaveBeenCalled();
    expect(service.uploads()[0].state).toBe('uploading');
  });

  it('rechaza formatos no admitidos', async () => {
    service.add([file('video.exe')]);
    config$.next(CONFIG);
    config$.complete();
    await flush();
    expect(service.uploads()[0]).toMatchObject({ state: 'error' });
    expect(tus.Upload).not.toHaveBeenCalled();
  });

  describe('con una subida en marcha', () => {
    let key: string;

    beforeEach(async () => {
      service.add([file()]);
      config$.next(CONFIG);
      config$.complete();
      await flush();
      key = service.uploads()[0].key;
    });

    it('ignora un onProgress tardío después de pausar', () => {
      service.pause(key);
      uploads[0].options.onProgress!(50, 100);
      expect(service.uploads()[0]).toMatchObject({ state: 'paused', loaded: 0 });
    });

    it('un 401 no ofrece «Reanudar»: queda en pausa esperando la sesión y la marca', () => {
      const error = Object.assign(new Error('401'), { originalResponse: { getStatus: () => 401, getBody: () => '' } });
      uploads[0].options.onError!(error as unknown as tus.DetailedError);
      TestBed.flushEffects();
      expect(service.uploads()[0]).toMatchObject({ state: 'paused', awaitingAuth: true, canResume: false });
      expect(session.markUnauthorized).toHaveBeenCalled();

      // Tras reautenticar continúa sola desde donde iba.
      authenticated.set(true);
      TestBed.flushEffects();
      expect(service.uploads()[0]).toMatchObject({ state: 'uploading', awaitingAuth: false });
    });

    it('un corte de red sí ofrece «Reanudar»', () => {
      uploads[0].options.onError!(new Error('red'));
      expect(service.uploads()[0]).toMatchObject({ state: 'error', canResume: true });
    });

    it('al caducar la sesión se pausa y continúa sola al volver a entrar', () => {
      authenticated.set(false);
      TestBed.flushEffects();
      expect(service.uploads()[0]).toMatchObject({ state: 'paused', awaitingAuth: true });
      expect(uploads[0].abort).toHaveBeenCalledWith(false);

      authenticated.set(true);
      TestBed.flushEffects();
      expect(service.uploads()[0]).toMatchObject({ state: 'uploading', awaitingAuth: false });
      expect(uploads[0].start).toHaveBeenCalledTimes(2);
    });

    it('cancelar aborta con DELETE y la quita de la lista', async () => {
      await service.cancel(key);
      expect(uploads[0].abort).toHaveBeenCalledWith(true);
      expect(service.uploads()).toHaveLength(0);
    });
  });
});
