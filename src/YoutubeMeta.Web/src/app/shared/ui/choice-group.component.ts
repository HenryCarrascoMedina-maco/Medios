import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface IChoice<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

let nextId = 0;

/** Grupo de opciones excluyentes con el estilo «choice» (radios). */
@Component({
  selector: 'ym-choice-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex flex-wrap gap-2" role="radiogroup" [attr.aria-label]="ariaLabel()">
      @for (option of options(); track $index) {
        <label class="choice">
          <input type="radio" [name]="name" [checked]="option.value === value()" [disabled]="!!option.disabled" (change)="value.set(option.value)" />
          {{ option.label }}
        </label>
      }
    </div>
  `
})
export class ChoiceGroupComponent<T> {
  readonly options = input.required<readonly IChoice<T>[]>();
  readonly value = model<T | null>(null);
  readonly ariaLabel = input<string | null>(null);

  protected readonly name = `ym-choice-${++nextId}`;
}
