import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap, timer } from 'rxjs';
import { InsightsHttp } from '../http/api.http';
import { IHealth } from '../models/api.models';

export const HEALTH_POLL_MS = 2 * 60_000;

/** Salud del sistema (GET /api/Insights/Health): el punto de la cabecera y el panel de Resultados. */
@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(InsightsHttp);
  readonly health = signal<IHealth | null>(null);

  /** Consulta ahora y cada 2 minutos mientras viva quien llama (el shell). */
  poll(destroyRef: DestroyRef): void {
    timer(0, HEALTH_POLL_MS)
      .pipe(
        switchMap(() => this.http.health().pipe(catchError(() => of(null)))),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe(health => {
        if (health) this.health.set(health);
      });
  }

  /** Lo ya cargado en otra pantalla se comparte con la cabecera. */
  set(health: IHealth): void {
    this.health.set(health);
  }
}
