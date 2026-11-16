import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ILoginResponse } from '../models/api.models';
import { readStored, removeStored, writeStored } from '../utils/storage';

const STORAGE_KEY = 'ym.session';
/** Aviso de caducidad: cuánto antes de expiresAt se ofrece «Seguir conectado». */
export const SESSION_WARNING_MS = 5 * 60_000;
/** setTimeout no admite más de ~24,8 días. */
const MAX_TIMEOUT_MS = 2_147_000_000;

/**
 * Sesión del usuario. La caducidad es reactiva: un temporizador actualiza `now` (una vez al llegar
 * la ventana de aviso y cada segundo dentro de ella), así `isAuthenticated` pasa a false justo en
 * expiresAt y el token deja de enviarse. La sesión caducada (o rechazada con 401) se conserva para
 * pedir solo la contraseña sin salir de la pantalla; `logout()` la borra del todo.
 */
@Injectable({ providedIn: 'root' })
export class SessionService implements OnDestroy {
  private readonly router = inject(Router);
  private readonly session = signal<ILoginResponse | null>(null);
  private readonly unauthorized = signal(false);
  private readonly now = signal(Date.now());
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') this.schedule();
  };

  readonly user = this.session.asReadonly();
  readonly expiresAt = computed(() => {
    const session = this.session();
    return session ? Date.parse(session.expiresAt) : 0;
  });
  readonly remainingMs = computed(() => Math.max(0, this.expiresAt() - this.now()));
  readonly isAuthenticated = computed(() => this.session() != null && !this.unauthorized() && this.remainingMs() > 0);
  /** Hay usuario pero su token ya no vale (caducó o el servidor respondió 401): pedir la contraseña. */
  readonly reauthRequired = computed(() => this.session() != null && !this.isAuthenticated());
  readonly expiringSoon = computed(() => this.isAuthenticated() && this.remainingMs() <= SESSION_WARNING_MS);

  constructor() {
    const stored = readStored<ILoginResponse | null>(STORAGE_KEY, null);
    // Al abrir la app con una sesión ya caducada no hay pantalla que conservar: se va al login.
    if (stored && Date.parse(stored.expiresAt) > Date.now()) this.session.set(stored);
    else if (stored) removeStored(STORAGE_KEY);
    this.schedule();
    document.addEventListener('visibilitychange', this.onVisible);
  }

  /** Se lee en cada petición (y en cada intento de SignalR/TUS), nunca se guarda en una variable. */
  getToken(): string | null {
    return this.isAuthenticated() ? this.session()!.token : null;
  }

  start(login: ILoginResponse): void {
    this.session.set(login);
    this.unauthorized.set(false);
    writeStored(STORAGE_KEY, login);
    this.schedule();
  }

  /** El servidor rechazó el token (401). Idempotente: varias peticiones a la vez cuentan como una. */
  markUnauthorized(): void {
    if (this.session() && !this.unauthorized()) this.unauthorized.set(true);
  }

  logout(redirect = true): void {
    this.session.set(null);
    this.unauthorized.set(false);
    this.clearTimer();
    removeStored(STORAGE_KEY);
    if (redirect) void this.router.navigate(['/login']);
  }

  ngOnDestroy(): void {
    this.clearTimer();
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  /** Actualiza `now` y programa el siguiente tic: al empezar el aviso, luego cada segundo hasta caducar. */
  private schedule(): void {
    this.clearTimer();
    const now = Date.now();
    this.now.set(now);
    if (!this.session()) return;

    const remaining = this.expiresAt() - now;
    if (remaining <= 0) return;
    const untilWarning = remaining - SESSION_WARNING_MS;
    const delay = untilWarning > 0 ? Math.min(untilWarning, MAX_TIMEOUT_MS) : Math.min(1000, remaining);
    this.timer = setTimeout(() => this.schedule(), delay);
  }

  private clearTimer(): void {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }
}
