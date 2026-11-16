import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { SessionService } from '../session/session.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let session: { getToken: jest.Mock; markUnauthorized: jest.Mock; logout: jest.Mock };

  beforeEach(() => {
    session = { getToken: jest.fn().mockReturnValue('tok'), markUnauthorized: jest.fn(), logout: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: SessionService, useValue: session }
      ]
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  const fail401 = (url: string) => backend.expectOne(url).flush(null, { status: 401, statusText: 'Unauthorized' });

  it('añade el Bearer solo a la API', () => {
    void firstValueFrom(http.get('/api/Video'));
    void firstValueFrom(http.get('https://otro.example/x'));
    expect(backend.expectOne('/api/Video').request.headers.get('Authorization')).toBe('Bearer tok');
    expect(backend.expectOne('https://otro.example/x').request.headers.has('Authorization')).toBe(false);
  });

  it('sin token no añade cabecera', () => {
    session.getToken.mockReturnValue(null);
    void firstValueFrom(http.get('/api/Video'));
    expect(backend.expectOne('/api/Video').request.headers.has('Authorization')).toBe(false);
  });

  it('un 401 marca la sesión para reautenticar (no hace logout) y propaga el error', async () => {
    const request = firstValueFrom(http.get('/api/Video'));
    fail401('/api/Video');
    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(session.markUnauthorized).toHaveBeenCalledTimes(1);
    expect(session.logout).not.toHaveBeenCalled();
  });

  it('varios 401 a la vez delegan la deduplicación en markUnauthorized (idempotente) sin logout', async () => {
    const requests = ['/api/A', '/api/B', '/api/C'].map(url => firstValueFrom(http.get(url)).catch(() => undefined));
    ['/api/A', '/api/B', '/api/C'].forEach(fail401);
    await Promise.all(requests);
    expect(session.markUnauthorized).toHaveBeenCalledTimes(3);
    expect(session.logout).not.toHaveBeenCalled();
  });

  it('un 401 del login es solo un error de credenciales', async () => {
    const request = firstValueFrom(http.post('/api/Auth/Login', {}));
    fail401('/api/Auth/Login');
    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(session.markUnauthorized).not.toHaveBeenCalled();
  });

  it('un 401 de Refresh sí pide reautenticar', async () => {
    const request = firstValueFrom(http.post('/api/Auth/Refresh', null));
    fail401('/api/Auth/Refresh');
    await expect(request).rejects.toBeTruthy();
    expect(session.markUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('otros errores no tocan la sesión', async () => {
    const request = firstValueFrom(http.get('/api/Video'));
    backend.expectOne('/api/Video').flush(null, { status: 500, statusText: 'Error' });
    await expect(request).rejects.toBeTruthy();
    expect(session.markUnauthorized).not.toHaveBeenCalled();
  });
});

describe('SessionService.markUnauthorized + interceptor (deduplicación real)', () => {
  it('muchos 401 dejan una sola transición a «reautenticar»', async () => {
    const { provideRouter } = await import('@angular/router');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()] });
    const session = TestBed.inject(SessionService);
    session.start({ token: 't', userName: 'admin', displayName: 'Admin', expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const spy = jest.spyOn(session, 'logout');
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);

    let transitions = 0;
    let previous = session.reauthRequired();
    const urls = ['/api/A', '/api/B', '/api/C', '/api/D'];
    const requests = urls.map(url => firstValueFrom(http.get(url)).catch(() => undefined));
    for (const url of urls) {
      backend.expectOne(url).flush(null, { status: 401, statusText: 'Unauthorized' });
      if (session.reauthRequired() !== previous) transitions++;
      previous = session.reauthRequired();
    }
    await Promise.all(requests);

    expect(transitions).toBe(1);
    expect(session.reauthRequired()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    session.logout(false);
  });
});
