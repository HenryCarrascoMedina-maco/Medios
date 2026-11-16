import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/** Casilla con su texto. <ym-checkbox [(checked)]="x">Texto</ym-checkbox> */
@Component({
  selector: 'ym-checkbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <label class="flex items-center gap-2 text-sm" [class.opacity-50]="disabled()">
      <input type="checkbox" class="shrink-0" [checked]="checked()" [disabled]="disabled()" (change)="checked.set($any($event.target).checked)" />
      <span><ng-content /></span>
    </label>
  `
})
export class CheckboxComponent {
  readonly checked = model(false);
  readonly disabled = input(false);
}
