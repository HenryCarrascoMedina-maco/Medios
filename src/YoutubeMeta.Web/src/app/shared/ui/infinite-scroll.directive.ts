import { Directive, ElementRef, OnDestroy, OnInit, inject, input, output } from '@angular/core';

/**
 * Emite `reached` cuando el elemento (un «centinela» al final de la lista) entra en pantalla.
 * Sin IntersectionObserver (navegadores muy viejos) no hace nada: queda el botón «Cargar más».
 */
@Directive({ selector: '[ymInfiniteScroll]' })
export class InfiniteScrollDirective implements OnInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private observer: IntersectionObserver | null = null;

  /** Margen para pedir antes de llegar al final. */
  readonly ymInfiniteScrollMargin = input('400px');
  readonly reached = output<void>();

  ngOnInit(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) this.reached.emit();
    }, { rootMargin: this.ymInfiniteScrollMargin() });
    this.observer.observe(this.element.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
