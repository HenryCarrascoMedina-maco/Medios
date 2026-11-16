import { DestroyRef, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, map, of, switchMap } from 'rxjs';
import { ToastService } from '../services/toast.service';
import { apiError } from './format';

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface ILoaderOptions {
  /** Mensaje si falla la carga (cuando el back no da uno legible). */
  errorMessage?: string;
  /** Traduce el error a texto (p. ej. 404 → «no existe»). Por defecto apiError(). */
  describeError?: (error: unknown, fallback: string) => string;
}

/** Estado de una carga: valor, estado y error, con recarga que cancela la petición anterior. */
export interface ILoader<T> {
  /** Último valor recibido. Se puede modificar en local (p. ej. avance en vivo del hub). */
  readonly value: WritableSignal<T | undefined>;
  readonly status: Signal<LoadStatus>;
  readonly error: Signal<string | null>;
  /** true mientras no hay ningún valor todavía (primera carga o tras reset). */
  readonly empty: Signal<boolean>;
  /** Vuelve a pedir los datos; si había una petición en curso, se cancela (switchMap). */
  reload(): void;
  /** Olvida el valor (al cambiar de entidad) y recarga. */
  reset(): void;
}

/**
 * Carga datos con estados loading / ready / error. Las recargas cancelan la petición anterior para
 * que una respuesta vieja no pise a una nueva. Si falla sin datos, el error se muestra en la pantalla
 * (con «Reintentar»); si falla con datos ya en pantalla, se avisa UNA vez con un toast hasta que
 * vuelva a cargar bien (sin lluvia de avisos con la red caída).
 *
 * Debe llamarse en un contexto de inyección (constructor o inicializador de campo).
 */
export function createLoader<T>(source: () => Observable<T>, options: ILoaderOptions = {}): ILoader<T> {
  const toast = inject(ToastService);
  const destroyRef = inject(DestroyRef);
  const fallback = options.errorMessage ?? 'No se pudieron cargar los datos.';
  const describe = options.describeError ?? apiError;

  const value = signal<T | undefined>(undefined);
  const status = signal<LoadStatus>('loading');
  const error = signal<string | null>(null);
  const requests = new Subject<void>();
  let notified = false;

  requests
    .pipe(
      switchMap(() => {
        status.set('loading');
        return source().pipe(
          map(data => ({ ok: true as const, data })),
          catchError((failure: unknown) => of({ ok: false as const, failure }))
        );
      }),
      takeUntilDestroyed(destroyRef)
    )
    .subscribe(result => {
      if (result.ok) {
        value.set(result.data);
        error.set(null);
        status.set('ready');
        notified = false;
        return;
      }
      const message = describe(result.failure, fallback);
      error.set(message);
      status.set('error');
      if (value() !== undefined && !notified) {
        notified = true;
        toast.error(message);
      }
    });

  return {
    value,
    status: status.asReadonly(),
    error: error.asReadonly(),
    empty: computed(() => value() === undefined),
    reload: () => requests.next(),
    reset: () => {
      value.set(undefined);
      notified = false;
      requests.next();
    }
  };
}
