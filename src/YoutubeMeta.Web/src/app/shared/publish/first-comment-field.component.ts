import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RulesService } from '@core/services/rules.service';
import { TemplateStoreService } from '@core/services/template-store.service';
import { TemplateEditorComponent } from '@shared/ui/template-editor.component';

/**
 * Primer comentario (opcional): lo pone la propia cuenta justo después de publicar, por ejemplo con
 * los hashtags. Solo aparece en las plataformas cuya capacidad lo permite (lo decide el diálogo).
 */
@Component({
  selector: 'ym-first-comment-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TemplateEditorComponent],
  host: { class: 'block' },
  template: `
    <label class="label" [for]="inputId()">{{ label() }} <small>opcional · {{ value().length }}/{{ rules().firstCommentMax }}</small></label>
    <ym-template-editor [inputId]="inputId()" [ariaLabel]="label()" [rows]="2" [toolbar]="false" [blocks]="blocks()" placeholder="#marketing #ventas"
                        [value]="value()" (valueChange)="valueChange.emit($event)" />
    <p class="hint">Lo escribe tu cuenta justo después de publicar. Si falla, la publicación queda hecha y podrás reintentar solo el comentario.</p>
  `
})
export class FirstCommentFieldComponent {
  protected readonly rules = inject(RulesService).rules;
  protected readonly blocks = inject(TemplateStoreService).blockNames;

  readonly inputId = input.required<string>();
  /** En Teams es «Primera respuesta en el hilo». */
  readonly label = input('Primer comentario');
  readonly value = input('');
  readonly valueChange = output<string>();
}
