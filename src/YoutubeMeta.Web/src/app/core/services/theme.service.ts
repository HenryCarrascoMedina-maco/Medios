import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'ym.theme';

/**
 * Tema claro/oscuro. Sin preferencia guardada sigue al sistema operativo (prefers-color-scheme),
 * también si cambia con la app abierta. index.html aplica la clase antes de pintar.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = window.matchMedia?.('(prefers-color-scheme: dark)');
  readonly dark = signal(document.documentElement.classList.contains('dark'));

  constructor() {
    this.media?.addEventListener?.('change', event => {
      if (this.stored() == null) this.apply(event.matches);
    });
  }

  toggle(): void {
    const dark = !this.dark();
    this.apply(dark);
    try {
      localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
    } catch {
      // Preferencia solo para esta sesión.
    }
  }

  private apply(dark: boolean): void {
    this.dark.set(dark);
    document.documentElement.classList.toggle('dark', dark);
  }

  private stored(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
}
