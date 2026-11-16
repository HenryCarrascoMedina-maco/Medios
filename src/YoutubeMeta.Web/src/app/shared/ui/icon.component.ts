import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ICONS, IIconDef, IconName } from './icons';

/**
 * Ícono SVG en línea. Decorativo por defecto (aria-hidden); con `label` se anuncia como imagen.
 * En un botón solo con ícono, el aria-label va en el botón.
 */
@Component({
  selector: 'ym-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0 items-center justify-center' },
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()"
         [attr.fill]="def().fill ? 'currentColor' : 'none'" [attr.stroke]="def().fill ? 'none' : 'currentColor'"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd"
         [class.animate-spin]="name() === 'spinner'"
         [attr.role]="label() ? 'img' : null" [attr.aria-label]="label()" [attr.aria-hidden]="label() ? null : 'true'" focusable="false">
      @for (d of def().paths; track $index) { <path [attr.d]="d" /> }
    </svg>
  `
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<number | string>(16);
  readonly label = input<string | null>(null);

  protected readonly def = computed<IIconDef>(() => ICONS[this.name()]);
}
