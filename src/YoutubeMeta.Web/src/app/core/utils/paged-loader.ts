import { DestroyRef, Signal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, map, of, switchMap } from 'rxjs';
import { IPage } from '../models/api.models';
import { ToastService } from '../services/toast.service';
import { ILoader, LoadStatus } from './loader';
import { apiError } from './format';

/** Lista paginada en el servidor con «cargar más» (scroll infinito). Compatible con <ym-async-state>. */
export interface IPagedLoader<T> extends ILoader<T[]> {
  readonly total: Signal<number>;
  readonly hasMore: Signal<boolean>;
  /** Pide la página siguiente si hay más y no se está cargando ya. */
  loadMore(): void;
}

/**
 * Como createLoader, pero acumula páginas. reload()/reset() empiezan de cero y cancelan lo que
 * estuviera en curso (incluida una página siguiente), así un filtro nuevo nunca mezcla resultados.
 * Debe llamarse en un contexto de inyección.
 */
export function createPagedLoader<T>(
  fetch: (offset: number, take: number) => Observable<IPage<T>>,
  options: { take?: number; errorMessage?: string } = {}
): IPagedLoader<T> {
  const toast = inject(ToastService);
  const destroyRef = inject(DestroyRef);
  const take = options.take ?? 48;
  const fallback = options.errorMessage ?? 'No se pudieron cargar los datos.';

  const value = signal<T[] | undefined>(undefined);
  const total = signal(0);
  const status = signal<LoadStatus>('loading');
  const error = signal<string | null>(null);
  const requests = new Subject<{ offset: number }>();

  requests
    .pipe(
      switchMap(({ offset }) => {
        status.set('loading');
        return fetch(offset, take).pipe(
          map(page => ({ ok: true as const, offset, page })),
          catchError((failure: unknown) => of({ ok: false as const, offset, failure }))
        );
      }),
      takeUntilDestroyed(destroyRef)
    )
    .subscribe(result => {
      if (result.ok) {
        value.set(result.offset === 0 ? result.page.items : [...(value() ?? []), ...result.page.items]);
        total.set(result.page.total);
        error.set(null);
        status.set('ready');
        return;
      }
      const message = apiError(result.failure, fallback);
      error.set(message);
      status.set('error');
      // Falló una página siguiente: lo ya cargado se queda; se avisa.
      if (result.offset > 0) toast.error(message);
    });

  const reload = () => requests.next({ offset: 0 });
  const hasMore = computed(() => (value()?.length ?? 0) < total());

  return {
    value,
    status: status.asReadonly(),
    error: error.asReadonly(),
    empty: computed(() => value() === undefined),
    total: total.asReadonly(),
    hasMore,
    reload,
    reset: () => {
      value.set(undefined);
      total.set(0);
      reload();
    },
    loadMore: () => {
      if (status() === 'loading' || !hasMore()) return;
      requests.next({ offset: value()?.length ?? 0 });
    }
  };
}

/**
 * Lista paginada por cursor (la bandeja): cada página se pide a partir del último elemento cargado. Reutiliza
 * createPagedLoader: si la página vino llena se supone que hay más (el «total» va un elemento por delante).
 * Debe llamarse en un contexto de inyección.
 */
export function createCursorLoader<T>(
  fetch: (last: T | null, take: number) => Observable<T[]>,
  options: { take?: number; errorMessage?: string } = {}
): IPagedLoader<T> {
  const take = options.take ?? 30;
  const loader: IPagedLoader<T> = createPagedLoader<T>((offset, size) =>
    fetch(offset === 0 ? null : loader.value()?.at(-1) ?? null, size).pipe(
      map(items => ({ items, total: offset + items.length + (items.length === size ? 1 : 0) }))
    ), { take, errorMessage: options.errorMessage });
  return loader;
}
