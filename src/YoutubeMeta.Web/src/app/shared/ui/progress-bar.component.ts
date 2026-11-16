import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PLATFORM_META } from '@core/constants/status.constants';
import { Platform } from '@core/models/api.models';

/**
 * Barra de progreso accesible. `processing` dibuja rayas animadas (la plataforma no da porcentaje).
 * Con `label` muestra encima el texto y el valor (p. ej. «Subidas hoy · 3 / 6»).
 */
@Component({
  selector: 'ym-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (label()) {
      <div class="mb-1 flex justify-between gap-2 text-xs"><span class="min-w-0 truncate">{{ label() }}</span><b class="shrink-0">{{ valueText() }}</b></div>
    }
    <div class="h-1.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin="0" aria-valuemax="100"
         [attr.aria-valuenow]="processing() ? null : clamped()" [attr.aria-valuetext]="processing() ? 'Procesando' : null"
         [attr.aria-label]="ariaLabel() ?? label() ?? 'Progreso'">
      <i class="block h-full rounded-full transition-all duration-500" [class]="barClass()" [style.width.%]="processing() ? 100 : clamped()"></i>
    </div>
  `,
  styles: `
    .stripes {
      background-image: repeating-linear-gradient(45deg, #7c3aed, #7c3aed 8px, #a78bfa 8px, #a78bfa 16px);
      background-size: 200% 100%;
    }
  `
})
export class ProgressBarComponent {
  readonly value = input<number | null>(0);
  readonly platform = input<Platform | null>(null);
  readonly processing = input(false);
  readonly label = input<string | null>(null);
  readonly valueText = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);

  protected readonly clamped = computed(() => Math.max(0, Math.min(100, this.value() ?? 0)));
  protected readonly barClass = computed(() => {
    if (this.processing()) return 'stripes animate-stripes';
    const platform = this.platform();
    return platform ? PLATFORM_META[platform].bar : 'bg-gradient-to-r from-brand to-brand-dark';
  });
}
