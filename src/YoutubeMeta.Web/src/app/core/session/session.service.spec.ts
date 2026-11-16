import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ILoginResponse } from '../models/api.models';
import { SESSION_WARNING_MS, SessionService } from './session.service';

const START = new Date('2026-11-15T10:00:00Z').getTime();
const MINUTE = 60_000;

function login(expiresInMs: number, token = 'tok-1'): ILoginResponse {
  return { token, userName: 'admin', displayName: 'Admin', expiresAt: new Date(Date.now() + expiresInMs).toISOString() };
}

describe('SessionService (caducidad)', () => {
  let service: SessionService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(START);
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    service = TestBed.inject(SessionService);
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('sin sesión no está autenticado ni pide reautenticar', () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.reauthRequired()).toBe(false);
    expect(service.getToken()).toBeNull();
  });

  it('pasa a no autenticado justo al llegar a expiresAt (sin otra señal que el temporizador)', () => {
    service.start(login(30 * MINUTE));
    expect(service.isAuthenticated()).toBe(true);
    expect(service.getToken()).toBe('tok-1');

    jest.advanceTimersByTime(30 * MINUTE - 1000);
    expect(service.isAuthenticated()).toBe(true);

    jest.advanceTimersByTime(1000);
    expect(service.isAuthenticated()).toBe(false);
    expect(service.getToken()).toBeNull();
    // La sesión se conserva para pedir solo la contraseña.
    expect(service.reauthRequired()).toBe(true);
    expect(service.user()?.userName).toBe('admin');
  });

  it('avisa 5 minutos antes y cuenta atrás cada segundo', () => {
    service.start(login(30 * MINUTE));
    expect(service.expiringSoon()).toBe(false);

    jest.advanceTimersByTime(30 * MINUTE - SESSION_WARNING_MS);
    expect(service.expiringSoon()).toBe(true);
    expect(service.remainingMs()).toBe(SESSION_WARNING_MS);

    jest.advanceTimersByTime(1000);
    expect(service.remainingMs()).toBe(SESSION_WARNING_MS - 1000);
  });

  it('antes de la ventana de aviso no despierta cada segundo (un solo temporizador)', () => {
    service.start(login(60 * MINUTE));
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(10 * MINUTE);
    expect(service.remainingMs()).toBe(60 * MINUTE); // `now` no se actualizó: no hacía falta
    expect(service.isAuthenticated()).toBe(true);
  });

  it('renovar (start) reprograma y quita el aviso', () => {
    service.start(login(4 * MINUTE));
    expect(service.expiringSoon()).toBe(true);
    service.start(login(60 * MINUTE, 'tok-2'));
    expect(service.expiringSoon()).toBe(false);
    expect(service.getToken()).toBe('tok-2');
    jest.advanceTimersByTime(10 * MINUTE);
    expect(service.isAuthenticated()).toBe(true);
  });

  it('markUnauthorized (401) invalida el token sin borrar el usuario; es idempotente', () => {
    service.start(login(60 * MINUTE));
    service.markUnauthorized();
    service.markUnauthorized();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.reauthRequired()).toBe(true);
    expect(service.getToken()).toBeNull();

    service.start(login(60 * MINUTE, 'tok-3'));
    expect(service.reauthRequired()).toBe(false);
    expect(service.getToken()).toBe('tok-3');
  });

  it('logout borra todo, para el temporizador y navega al login', () => {
    service.start(login(60 * MINUTE));
    service.logout();
    expect(service.user()).toBeNull();
    expect(service.reauthRequired()).toBe(false);
    expect(localStorage.getItem('ym.session')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/login']);
  });

  it('al arrancar descarta una sesión guardada ya caducada', () => {
    localStorage.setItem('ym.session', JSON.stringify(login(-MINUTE)));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fresh = TestBed.inject(SessionService);
    expect(fresh.user()).toBeNull();
    expect(localStorage.getItem('ym.session')).toBeNull();
  });

  it('al arrancar recupera una sesión guardada vigente', () => {
    localStorage.setItem('ym.session', JSON.stringify(login(MINUTE * 20)));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    expect(TestBed.inject(SessionService).isAuthenticated()).toBe(true);
  });
});
