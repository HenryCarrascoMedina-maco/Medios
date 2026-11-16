import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, input, output, viewChild } from '@angular/core';
import { ConfirmService } from '@core/services/confirm.service';
import { IconComponent } from './icon.component';

/** Modales abiertos, del de abajo al de arriba: Escape y Tab solo actúan sobre el último. */
const stack: ModalComponent[] = [];
let nextId = 0;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal accesible: role="dialog", aria-modal, título enlazado, foco atrapado dentro y
 * devuelto al cerrar. Con `dirty`, pide confirmación antes de cerrar por Escape, clic fuera, ✕ o
 * requestClose() (el botón «Cancelar» del pie debe llamar a requestClose()).
 */
@Component({
  selector: 'ym-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { '(document:keydown)': 'onKeydown($event)' },
  template: `
    <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-8" (click)="closable() && requestClose()">
      <div #panel class="card w-full animate-fade-in-up outline-none" [style.max-width.px]="width()" (click)="$event.stopPropagation()"
           role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" tabindex="-1">
        <div class="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <ng-content select="[modal-icon]" />
          <h2 [id]="titleId" class="flex-1 text-base font-semibold">{{ title() }}</h2>
          @if (closable()) {
            <button type="button" class="btn btn-ghost btn-sm btn-icon" (click)="requestClose()" aria-label="Cerrar"><ym-icon name="close" /></button>
          }
        </div>
        <div class="grid gap-4 px-5 py-4">
          <ng-content />
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          <ng-content select="[modal-footer]" />
        </div>
      </div>
    </div>
  `
})
export class ModalComponent implements AfterViewInit, OnDestroy {
  private readonly confirm = inject(ConfirmService);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly previousFocus = document.activeElement as HTMLElement | null;
  private asking = false;

  readonly title = input.required<string>();
  readonly width = input(720);
  /** Hay cambios sin guardar: se confirma antes de cerrar. */
  readonly dirty = input(false);
  readonly dirtyMessage = input('Se perderá lo que escribiste en este diálogo.');
  /** false = no se puede cerrar con Escape, clic fuera ni ✕ (p. ej. reautenticación obligatoria). */
  readonly closable = input(true);
  readonly closed = output<void>();

  protected readonly titleId = `ym-modal-title-${++nextId}`;

  constructor() {
    stack.push(this);
  }

  ngAfterViewInit(): void {
    const panel = this.panel().nativeElement;
    const first = panel.querySelector<HTMLElement>('[autofocus]') ?? this.focusables().find(el => !el.closest('[aria-label="Cerrar"]')) ?? panel;
    first.focus();
  }

  ngOnDestroy(): void {
    const index = stack.indexOf(this);
    if (index >= 0) stack.splice(index, 1);
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }

  /** Cierra, pidiendo confirmación si hay cambios sin guardar. */
  async requestClose(): Promise<void> {
    if (this.asking) return;
    if (this.dirty()) {
      this.asking = true;
      const accepted = await this.confirm.ask({ title: '¿Descartar los cambios?', message: this.dirtyMessage(), confirmText: 'Descartar', danger: true });
      this.asking = false;
      if (!accepted) return;
    }
    this.closed.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (stack[stack.length - 1] !== this) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.closable()) void this.requestClose();
    } else if (event.key === 'Tab') {
      this.trapFocus(event);
    }
  }

  private trapFocus(event: KeyboardEvent): void {
    const items = this.focusables();
    const panel = this.panel().nativeElement;
    if (items.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusables(): HTMLElement[] {
    return Array.from(this.panel().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null || el === document.activeElement);
  }
}
