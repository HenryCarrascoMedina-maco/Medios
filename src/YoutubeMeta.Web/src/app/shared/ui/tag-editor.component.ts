import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { ITagCount } from '@core/models/api.models';
import { parseTags } from '@core/utils/tags';
import { IconComponent } from './icon.component';

let nextId = 0;

/**
 * Editor de etiquetas: pastillas con ✕ y un campo para añadir (Intro o coma), con sugerencias de
 * las etiquetas existentes. [(tags)] devuelve la lista ya normalizada como en el servidor.
 */
@Component({
  selector: 'ym-tag-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'block' },
  template: `
    <div class="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-field px-2 py-1.5 focus-within:border-brand">
      @for (tag of tags(); track tag) {
        <span class="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs">
          #{{ tag }}
          <button type="button" class="rounded-full opacity-60 hover:opacity-100" [attr.aria-label]="'Quitar ' + tag" (click)="remove(tag)"><ym-icon name="close" [size]="11" /></button>
        </span>
      }
      <input class="min-w-[8rem] flex-1 bg-transparent py-0.5 text-sm outline-none" [attr.list]="listId" [placeholder]="placeholder()" [attr.aria-label]="placeholder()"
             [value]="draft()" (input)="onInput($any($event.target).value)" (keydown.enter)="$event.preventDefault(); commit()" (blur)="commit()"
             (keydown.backspace)="!draft() && tags().length && remove(tags()[tags().length - 1])" />
      <datalist [id]="listId">
        @for (s of available(); track s.tag) { <option [value]="s.tag">{{ s.videoCount }} videos</option> }
      </datalist>
    </div>
  `
})
export class TagEditorComponent {
  readonly tags = model<string[]>([]);
  readonly suggestions = input<readonly ITagCount[]>([]);
  readonly placeholder = input('Añadir etiqueta…');

  protected readonly draft = signal('');
  protected readonly listId = `ym-tags-${++nextId}`;
  protected readonly available = computed(() => this.suggestions().filter(s => !this.tags().includes(s.tag)));

  protected onInput(value: string): void {
    if (value.includes(',')) {
      this.draft.set(value);
      this.commit();
    } else {
      this.draft.set(value);
    }
  }

  protected commit(): void {
    const added = parseTags(this.draft()).filter(t => !this.tags().includes(t));
    this.draft.set('');
    if (added.length) this.tags.set([...this.tags(), ...added]);
  }

  protected remove(tag: string): void {
    this.tags.set(this.tags().filter(t => t !== tag));
  }
}
