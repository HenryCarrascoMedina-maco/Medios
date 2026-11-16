import { Injectable, OnDestroy, signal } from '@angular/core';

/** Cada cuánto avanza el reloj compartido. Las validaciones de fecha no necesitan más precisión. */
export const CLOCK_TICK_MS = 30_000;

/**
 * Hora actual como signal: los computed que dependen de «ahora» (fecha mínima para programar,
 * «la fecha debe ser futura») se recalculan solos cada 30 s en lugar de quedarse congelados.
 */
@Injectable({ providedIn: 'root' })
export class ClockService implements OnDestroy {
  private readonly current = signal(Date.now());
  private readonly timer = setInterval(() => this.current.set(Date.now()), CLOCK_TICK_MS);

  readonly now = this.current.asReadonly();

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
}
