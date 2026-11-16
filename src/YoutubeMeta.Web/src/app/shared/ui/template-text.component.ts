import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TemplateUsage } from '@core/models/api.models';
import { TemplateSegmentKind, tokenize } from '@core/utils/template-vars';

/** Color de cada tipo de etiqueta: lo comparten el editor, su menú y las tarjetas de plantillas. */
export const TOKEN_CLASS: Readonly<Record<TemplateSegmentKind, string>> = {
  text: '',
  var: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  block: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  field: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  bad: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300'
};

/** Texto de una plantilla (solo lectura) con las etiquetas resaltadas. */
@Component({
  selector: 'ym-template-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block whitespace-pre-line break-words' },
  template: `@for (s of segments(); track $index) {@if (s.kind === 'text') {{{ s.text }}} @else {<span class="rounded px-0.5 font-mono text-[0.92em]" [class]="tokenClass[s.kind]" [title]="s.problem ?? ''">{{ s.text }}</span>}}`
})
export class TemplateTextComponent {
  readonly text = input<string | null>(null);
  readonly usage = input<TemplateUsage | undefined>(undefined);
  /** Bloques que existen (los demás salen en rojo). */
  readonly blocks = input<readonly string[] | undefined>(undefined);

  protected readonly tokenClass = TOKEN_CLASS;
  protected readonly segments = computed(() => tokenize(this.text(), { usage: this.usage(), blocks: this.blocks() }));
}
