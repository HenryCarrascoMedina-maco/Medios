import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type ChipTone = 'neutral' | 'outline' | 'brand' | 'violet' | 'success' | 'danger' | 'warning';

const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  neutral: 'bg-surface-muted text-slate-600 dark:text-slate-300',
  outline: 'border border-line text-slate-500 dark:text-slate-400',
  brand: 'bg-brand-soft text-brand-dark dark:bg-brand/15 dark:text-brand',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  success: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  danger: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
};

/** Pastilla con tono semántico: estados, contadores y etiquetas cortas. */
@Component({
  selector: 'ym-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'css()' },
  template: `<ng-content />`
})
export class ChipComponent {
  readonly tone = input<ChipTone>('neutral');

  protected readonly css = computed(() =>
    `inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP_TONE_CLASS[this.tone()]}`);
}
