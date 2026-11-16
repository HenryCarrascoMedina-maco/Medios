import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastKind, ToastService } from '@core/services/toast.service';
import { IconComponent } from './icon.component';
import { IconName } from './icons';

const KIND: Record<ToastKind, { css: string; icon: IconName }> = {
  success: { css: 'bg-green-700', icon: 'success' },
  error: { css: 'bg-red-700', icon: 'error' },
  info: { css: 'bg-slate-800', icon: 'info' },
  warning: { css: 'bg-amber-600', icon: 'warning' }
};

/** Avisos flotantes. Región aria-live: los lectores de pantalla los anuncian sin mover el foco. */
@Component({
  selector: 'ym-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="fixed bottom-20 right-4 z-[60] grid w-[min(380px,calc(100vw-2rem))] gap-2 md:bottom-4" role="status" aria-live="polite" aria-relevant="additions">
      @for (toast of toasts.toasts(); track toast.id) {
        <div class="flex animate-fade-in-up items-start gap-2 rounded-xl px-4 py-3 text-sm text-white shadow-lg" [class]="kind[toast.kind].css"
             [attr.role]="toast.kind === 'error' ? 'alert' : null">
          <ym-icon [name]="kind[toast.kind].icon" class="mt-0.5" />
          <span class="flex-1">{{ toast.message }}</span>
          <button type="button" class="-mr-1 rounded p-0.5 opacity-80 hover:opacity-100" aria-label="Cerrar aviso" (click)="toasts.dismiss(toast.id)">
            <ym-icon name="close" [size]="14" />
          </button>
        </div>
      }
    </div>
  `
})
export class ToastHostComponent {
  protected readonly toasts = inject(ToastService);
  protected readonly kind = KIND;
}
