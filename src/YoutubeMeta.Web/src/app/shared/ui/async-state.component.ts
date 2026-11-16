import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ILoader } from '@core/utils/loader';
import { IconComponent } from './icon.component';

/**
 * Pinta los estados de una carga: «Cargando…», error con «Reintentar», vacío o el contenido.
 * Mientras ya hay datos, una recarga o un fallo en segundo plano no ocultan el contenido.
 *
 *   <ym-async-state [loader]="videos" [isEmpty]="!list().length" emptyText="Sin videos.">…</ym-async-state>
 */
@Component({
  selector: 'ym-async-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'block' },
  template: `
    @switch (view()) {
      @case ('loading') {
        <div class="flex items-center justify-center gap-2 py-10 text-sm muted" role="status">
          <ym-icon name="spinner" /> {{ loadingText() }}
        </div>
      }
      @case ('error') {
        <div class="card mx-auto max-w-md p-6 text-center" role="alert">
          <ym-icon name="warning" [size]="28" class="mb-2 text-amber-500" />
          <p class="text-sm">{{ loader().error() }}</p>
          <button type="button" class="btn btn-primary btn-sm mt-3" (click)="loader().reload()">
            <ym-icon name="retry" [size]="14" /> Reintentar
          </button>
        </div>
      }
      @case ('empty') {
        <div class="py-12 text-center text-sm muted">
          {{ emptyText() }}
          <ng-content select="[empty]" />
        </div>
      }
      @default { <ng-content /> }
    }
  `
})
export class AsyncStateComponent {
  readonly loader = input.required<ILoader<unknown>>();
  readonly isEmpty = input(false);
  readonly emptyText = input('');
  readonly loadingText = input('Cargando…');

  protected readonly view = computed<'loading' | 'error' | 'empty' | 'content'>(() => {
    const loader = this.loader();
    if (loader.empty()) return loader.status() === 'error' ? 'error' : 'loading';
    return this.isEmpty() ? 'empty' : 'content';
  });
}
