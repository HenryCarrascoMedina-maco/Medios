import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * «Completa antes de …»: un campo por cada {?campo} de la plantilla elegida. El texto se actualiza solo mientras se
 * escribe (el padre resuelve con estos valores). Lo usan el diálogo de publicación y la bandeja.
 */
@Component({
  selector: 'ym-template-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <fieldset class="rounded-lg border border-dashed border-brand bg-brand-soft p-2.5 dark:bg-brand/10">
      <legend class="px-1 text-xs font-semibold">{{ title() }}</legend>
      <div class="grid gap-2 sm:grid-cols-2">
        @for (name of names(); track name; let first = $first) {
          <label class="flex items-center gap-2 text-xs">
            <span class="w-24 shrink-0 truncate font-medium" [title]="name">{{ name }}</span>
            <input class="input !py-1 text-sm" [attr.aria-label]="name" [value]="valueOf(name)" [attr.autofocus]="first && autofocus() ? '' : null"
                   (input)="set(name, $any($event.target).value)" />
          </label>
        }
      </div>
    </fieldset>
  `
})
export class TemplateFieldsComponent {
  /** Nombres de los campos, en orden de aparición. */
  readonly names = input.required<readonly string[]>();
  readonly values = model<Readonly<Record<string, string>>>({});
  readonly title = input('Completa antes de enviar');
  readonly autofocus = input(false);

  protected valueOf(name: string): string {
    return this.values()[name] ?? '';
  }

  protected set(name: string, value: string): void {
    this.values.set({ ...this.values(), [name]: value });
  }
}
