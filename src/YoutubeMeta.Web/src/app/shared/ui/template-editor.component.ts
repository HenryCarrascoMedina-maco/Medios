import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, output, signal, viewChild } from '@angular/core';
import { TemplateUsage } from '@core/models/api.models';
import {
  FIELD_NAME, ITemplateSegment, TEMPLATE_VARIABLES, TemplateVariableGroup, insertAt, tokenRangeAt, tokenTouching, tokenize
} from '@core/utils/template-vars';
import { IconComponent } from './icon.component';
import { TOKEN_CLASS } from './template-text.component';

/** Una opción del menú de etiquetas. `disabled` = no vale para este uso (se muestra apagada con el motivo). */
interface IMenuItem {
  token: string;
  label: string;
  group: TemplateVariableGroup | 'Bloques de hashtags' | 'Campo a completar';
  kind: ITemplateSegment['kind'];
  disabled?: string;
}

type MenuMode = 'vars' | 'blocks';

/** Lo que se está escribiendo antes del cursor y abre el menú: «{ti», «{?pre» o «#blo». */
const TRIGGER = /(\{\??[\p{L}\p{N}_]*|#(?:b(?:l(?:o(?:q(?:u(?:e(?::[a-z0-9_-]*)?)?)?)?)?)?)?)$/u;

/**
 * Caja de texto con etiquetas: {titulo}, {nombre}, {?campo} y #bloque:x se resaltan y se comportan como una sola pieza
 * (Retroceso o Suprimir las borran enteras; un clic dentro las selecciona). Escribir «{» o «#» abre el menú de
 * etiquetas, que también se abre desde la barra.
 *
 * Es una <textarea> normal sobre una capa con el mismo texto que solo pinta el fondo de cada etiqueta: deshacer,
 * autocorrector, teclado del móvil y lectores de pantalla funcionan como en cualquier campo.
 */
@Component({
  selector: 'ym-template-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'block' },
  styles: `
    .te-text { font: inherit; letter-spacing: normal; white-space: pre-wrap; overflow-wrap: break-word; word-break: normal; tab-size: 4; }
    .te-mark { border-radius: 4px; box-shadow: 0 0 0 1px currentColor; color: transparent; }
  `,
  template: `
    <div class="relative rounded-lg border bg-field transition"
         [class]="hasFocus() ? 'border-brand ring-2 ring-brand/20' : 'border-line'">
      @if (toolbar()) {
        <div class="flex items-center gap-0.5 overflow-x-auto border-b border-line px-1.5 py-1" role="toolbar" [attr.aria-label]="'Insertar en ' + ariaLabel()">
          <button type="button" class="btn btn-ghost btn-sm shrink-0" title="Insertar una etiqueta (o escribe «{»)" (mousedown)="$event.preventDefault()" (click)="openMenu('vars')">
            <span class="font-mono text-[11px]">{{ '{ }' }}</span> Etiqueta
          </button>
          @if (blocks().length) {
            <button type="button" class="btn btn-ghost btn-sm shrink-0" title="Insertar un bloque de hashtags (o escribe «#»)" (mousedown)="$event.preventDefault()" (click)="openMenu('blocks')">
              <ym-icon name="tag" [size]="12" /> Bloque
            </button>
          }
          <button type="button" class="btn btn-ghost btn-sm shrink-0" title="Un dato que se pregunta al usar la plantilla" (mousedown)="$event.preventDefault()" (click)="askField()">
            <ym-icon name="edit" [size]="12" /> Campo a completar
          </button>
          <ng-content select="[editor-tools]" />
        </div>
      }

      <div class="relative">
        <div class="te-text pointer-events-none absolute inset-0 overflow-hidden px-3 py-2 text-sm leading-6" aria-hidden="true" #backdrop>@for (s of segments(); track $index) {@if (s.kind === 'text') {<span class="text-transparent">{{ s.text }}</span>} @else {<mark class="te-mark" [class]="markClass(s.kind)">{{ s.text }}</mark>}}{{ '\\n' }}</div>
        <textarea #field class="te-text relative block w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-slate-900 outline-none dark:text-slate-100"
                  [id]="inputId()" [attr.aria-label]="ariaLabel()" [attr.placeholder]="placeholder()" [attr.maxlength]="maxlength()"
                  [rows]="multiline() ? rows() : 1" [value]="value()" spellcheck="true"
                  role="combobox" aria-autocomplete="list" [attr.aria-expanded]="menuOpen()" [attr.aria-controls]="menuId()"
                  [attr.aria-activedescendant]="menuOpen() && items().length ? menuId() + '-' + active() : null"
                  (input)="onInput()" (keydown)="onKeydown($event)" (click)="onClick()" (keyup)="onKeyup($event)" (scroll)="syncScroll()"
                  (focus)="hasFocus.set(true); focused.emit($event)" (blur)="onBlur()"></textarea>
      </div>

      @if (askingField()) {
        <div class="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
          <label class="text-xs font-semibold" [for]="inputId() + '-field'">Nombre del campo</label>
          <input [id]="inputId() + '-field'" class="input !w-40 !py-1 text-xs" maxlength="30" placeholder="precio" autofocus
                 [value]="fieldName()" (input)="fieldName.set($any($event.target).value)"
                 (keydown.enter)="$event.preventDefault(); insertField()" (keydown.escape)="askingField.set(false)" />
          <button type="button" class="btn btn-primary btn-sm" [disabled]="!validField()" (click)="insertField()">Insertar</button>
          <button type="button" class="btn btn-ghost btn-sm" (click)="askingField.set(false)">Cancelar</button>
          @if (fieldName() && !validField()) { <span class="text-xs text-red-500">Solo letras, números y _ (sin espacios).</span> }
        </div>
      }

      @if (menuOpen()) {
        <div class="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg sm:right-auto sm:w-80"
             role="listbox" [id]="menuId()" [attr.aria-label]="menuMode() === 'blocks' ? 'Bloques de hashtags' : 'Etiquetas'">
          @for (item of items(); track item.token; let i = $index) {
            @if (i === 0 || items()[i - 1].group !== item.group) { <div class="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide muted" role="presentation">{{ item.group }}</div> }
            <div class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs" role="option" [id]="menuId() + '-' + i"
                 [attr.aria-selected]="i === active()" [attr.aria-disabled]="!!item.disabled"
                 [class]="item.disabled ? 'cursor-not-allowed opacity-50' : i === active() ? 'bg-brand-soft dark:bg-brand/15' : 'hover:bg-field'"
                 (mousedown)="$event.preventDefault()" (click)="choose(item)" (mouseenter)="active.set(i)">
              <code class="rounded px-1 font-mono text-[11px]" [class]="markClass(item.kind)">{{ item.token }}</code>
              <span class="ml-auto truncate text-right muted">{{ item.disabled ?? item.label }}</span>
            </div>
          } @empty {
            <p class="px-2 py-1.5 text-xs muted">{{ menuMode() === 'blocks' ? 'No hay bloques con ese nombre. Créalos en Ajustes › Plantillas.' : 'Ninguna etiqueta coincide.' }}</p>
          }
          <p class="mt-1 border-t border-line px-2 pt-1 text-[10px] muted">↑↓ para elegir · Enter para insertar · Esc para cerrar</p>
        </div>
      }
      <ng-content />
    </div>
  `
})
export class TemplateEditorComponent {
  private static nextId = 0;

  readonly value = model('');
  /** Qué etiquetas valen: una publicación no conoce al cliente y una respuesta no tiene título de video. */
  readonly usage = input<TemplateUsage>('PUBLISH');
  /** Bloques de hashtags que existen (los demás se marcan en rojo). */
  readonly blocks = input<readonly string[]>([]);
  readonly multiline = input(true);
  readonly rows = input(4);
  readonly toolbar = input(true);
  readonly inputId = input(`te-${TemplateEditorComponent.nextId++}`);
  readonly ariaLabel = input('Texto');
  readonly placeholder = input<string | null>(null);
  readonly maxlength = input<number | null>(null);
  readonly focused = output<FocusEvent>();

  private readonly field = viewChild.required<ElementRef<HTMLTextAreaElement>>('field');
  private readonly backdrop = viewChild.required<ElementRef<HTMLDivElement>>('backdrop');
  protected readonly menuId = computed(() => `${this.inputId()}-menu`);

  protected readonly hasFocus = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly menuMode = signal<MenuMode>('vars');
  /** Lo escrito tras «{» o «#» (filtra el menú) y dónde empieza, para reemplazarlo al elegir. */
  private readonly query = signal<{ text: string; start: number } | null>(null);
  protected readonly active = signal(0);
  protected readonly askingField = signal(false);
  protected readonly fieldName = signal('');
  protected readonly validField = computed(() => FIELD_NAME.test(this.fieldName().trim()));

  protected readonly segments = computed(() => tokenize(this.value(), { usage: this.usage(), blocks: this.blocks() }));

  protected readonly items = computed<IMenuItem[]>(() => {
    const query = this.query()?.text ?? '';
    if (this.menuMode() === 'blocks') {
      const name = query.replace(/^#(b(l(o(q(u(e(:)?)?)?)?)?)?)?/, '');
      return this.blocks()
        .filter(b => b.startsWith(name))
        .map(b => ({ token: `#bloque:${b}`, label: 'Bloque de hashtags', group: 'Bloques de hashtags', kind: 'block' }));
    }
    const typed = query.replace(/^\{/, '');
    const usage = this.usage();
    const variables: IMenuItem[] = TEMPLATE_VARIABLES
      .filter(v => !typed || (!typed.startsWith('?') && v.token.slice(1).startsWith(typed)))
      .map(v => ({
        token: v.token, label: v.label, group: v.group, kind: 'var',
        disabled: v.usages.includes(usage) ? undefined : usage === 'PUBLISH' ? 'solo en respuestas' : 'solo en publicaciones'
      }));
    const name = typed.replace(/^\?/, '');
    const field: IMenuItem = { token: name && FIELD_NAME.test(name) ? `{?${name}}` : '{?…}', label: 'Se pregunta al usarla', group: 'Campo a completar', kind: 'field' };
    // Los apagados van al final del grupo para que Enter elija uno válido.
    return [...variables.filter(v => !v.disabled), ...variables.filter(v => v.disabled), field];
  });

  protected markClass(kind: ITemplateSegment['kind']): string {
    return TOKEN_CLASS[kind];
  }

  /** Inserta `token` en el cursor (o reemplaza lo que se estaba escribiendo para el menú). */
  private insert(token: string): void {
    const el = this.field().nativeElement;
    const query = this.query();
    const start = query ? query.start : el.selectionStart;
    const end = query ? el.selectionStart : el.selectionEnd;
    const { text, caret } = insertAt(el.value, token, start, end);
    this.write(text, caret);
    this.closeMenu();
  }

  protected openMenu(mode: MenuMode): void {
    this.field().nativeElement.focus();
    this.query.set(null);
    this.menuMode.set(mode);
    this.active.set(0);
    this.menuOpen.set(true);
  }

  protected askField(): void {
    this.closeMenu();
    this.fieldName.set('');
    this.askingField.set(true);
  }

  protected insertField(): void {
    if (!this.validField()) return;
    this.askingField.set(false);
    this.field().nativeElement.focus();
    this.insert(`{?${this.fieldName().trim()}}`);
  }

  protected choose(item: IMenuItem): void {
    if (item.disabled) return;
    if (item.token === '{?…}') {
      this.askField();
      return;
    }
    this.insert(item.token);
  }

  protected onInput(): void {
    const el = this.field().nativeElement;
    // Una sola línea: sin saltos (también los pegados).
    if (!this.multiline() && /\n/.test(el.value)) {
      const caret = el.selectionStart;
      el.value = el.value.replace(/\n+/g, ' ');
      el.setSelectionRange(caret, caret);
    }
    this.value.set(el.value);
    this.autoGrow();
    this.detectTrigger();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.menuOpen()) {
      const list = this.items();
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this.active.set(list.length ? (this.active() + 1) % list.length : 0);
          return;
        case 'ArrowUp':
          event.preventDefault();
          this.active.set(list.length ? (this.active() - 1 + list.length) % list.length : 0);
          return;
        case 'Enter':
        case 'Tab':
          if (list[this.active()] && !list[this.active()].disabled) {
            event.preventDefault();
            this.choose(list[this.active()]);
            return;
          }
          break;
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          this.closeMenu();
          return;
      }
    }
    if (event.key === 'Enter' && !this.multiline()) {
      event.preventDefault();
      return;
    }
    // Retroceso o Suprimir junto a una etiqueta la borran entera.
    const el = this.field().nativeElement;
    if ((event.key === 'Backspace' || event.key === 'Delete') && el.selectionStart === el.selectionEnd) {
      const range = tokenTouching(el.value, el.selectionStart, event.key === 'Backspace' ? 'before' : 'after');
      if (range) {
        event.preventDefault();
        this.write(el.value.slice(0, range.start) + el.value.slice(range.end), range.start);
      }
    }
  }

  /** Las flechas no dejan el cursor dentro de una etiqueta: la saltan. */
  protected onKeyup(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const el = this.field().nativeElement;
    if (el.selectionStart !== el.selectionEnd) return;
    const range = tokenRangeAt(el.value, el.selectionStart);
    if (range) {
      const caret = event.key === 'ArrowLeft' ? range.start : range.end;
      el.setSelectionRange(caret, caret);
    }
  }

  /** Un clic dentro de una etiqueta la selecciona entera. */
  protected onClick(): void {
    const el = this.field().nativeElement;
    if (el.selectionStart !== el.selectionEnd) return;
    const range = tokenRangeAt(el.value, el.selectionStart);
    if (range) el.setSelectionRange(range.start, range.end);
    this.detectTrigger();
  }

  protected onBlur(): void {
    this.hasFocus.set(false);
    this.closeMenu();
  }

  protected syncScroll(): void {
    this.backdrop().nativeElement.scrollTop = this.field().nativeElement.scrollTop;
  }

  private detectTrigger(): void {
    const el = this.field().nativeElement;
    if (el.selectionStart !== el.selectionEnd) return this.closeMenu();
    const before = el.value.slice(0, el.selectionStart);
    const match = TRIGGER.exec(before);
    if (!match) return this.closeMenu();
    const text = match[1];
    const mode: MenuMode = text.startsWith('#') ? 'blocks' : 'vars';
    if (mode === 'blocks' && !this.blocks().length) return this.closeMenu();
    this.menuMode.set(mode);
    this.query.set({ text, start: el.selectionStart - text.length });
    this.active.set(0);
    this.menuOpen.set(true);
  }

  private closeMenu(): void {
    this.menuOpen.set(false);
    this.query.set(null);
  }

  /** Cambia el texto como si se tecleara (deshacer del navegador incluido) y deja el cursor en `caret`. */
  private write(text: string, caret: number): void {
    const el = this.field().nativeElement;
    el.focus();
    el.setSelectionRange(0, el.value.length);
    // execCommand conserva el historial de deshacer; si no está disponible, se asigna el valor.
    if (!document.execCommand?.('insertText', false, text)) el.value = text;
    el.setSelectionRange(caret, caret);
    this.value.set(el.value);
    this.autoGrow();
  }

  /** Crece con el texto (sin barra de desplazamiento) hasta 16 líneas. */
  private autoGrow(): void {
    if (!this.multiline()) return;
    const el = this.field().nativeElement;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 16 * 24 + 16)}px`;
    this.syncScroll();
  }
}
