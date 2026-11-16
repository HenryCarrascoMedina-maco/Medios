import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PosterService } from '@core/services/poster.service';
import { image, pdf } from '../../testing/page-mocks';
import { MediaStripComponent, moveItem } from './media-strip.component';
import { IMediaItem } from './publish.models';

describe('moveItem', () => {
  it('mueve sin mutar y no hace nada fuera de rango', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(list, 1, 5)).toEqual(list);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});

describe('MediaStripComponent', () => {
  @Component({
    imports: [MediaStripComponent],
    template: `<ym-media-strip [(items)]="items" (add)="added = added + 1" />`
  })
  class Host {
    readonly items = signal<readonly IMediaItem[]>([{ video: image(1), alt: '' }, { video: image(2), alt: '' }, { video: pdf(3), alt: '' }]);
    added = 0;
  }

  const setup = () => {
    TestBed.configureTestingModule({ providers: [{ provide: PosterService, useValue: { get: () => Promise.resolve(null), revision: signal(0) } }] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = (label: string) => {
      (el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click();
      fixture.detectChanges();
    };
    const ids = () => fixture.componentInstance.items().map(i => i.video.id);
    return { fixture, el, click, ids };
  };

  afterEach(() => TestBed.resetTestingModule());

  it('reordena con las flechas (sin pasar de los extremos)', () => {
    const { el, click, ids } = setup();
    click('Mover después Imagen 1');
    expect(ids()).toEqual([2, 1, 3]);
    click('Mover antes Documento 3');
    expect(ids()).toEqual([2, 3, 1]);
    expect((el.querySelector('button[aria-label="Mover antes Imagen 2"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('quita un medio', () => {
    const { click, ids } = setup();
    click('Quitar Imagen 2');
    expect(ids()).toEqual([1, 3]);
  });

  it('texto alternativo solo para imágenes', () => {
    const { fixture, el } = setup();
    const alts = el.querySelectorAll('input[aria-label^="Texto alternativo"]') as NodeListOf<HTMLInputElement>;
    expect(alts.length).toBe(2);
    alts[1].value = 'Gráfico de ventas';
    alts[1].dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.items()[1].alt).toBe('Gráfico de ventas');
  });

  it('arrastrar y soltar cambia el orden', () => {
    const { fixture, el, ids } = setup();
    const tiles = el.querySelectorAll('li[draggable="true"]');
    const transfer = { setData: () => undefined, effectAllowed: '' };
    tiles[0].dispatchEvent(Object.assign(new Event('dragstart'), { dataTransfer: transfer }));
    tiles[2].dispatchEvent(Object.assign(new Event('dragover', { cancelable: true }), { dataTransfer: transfer }));
    tiles[2].dispatchEvent(Object.assign(new Event('drop', { cancelable: true }), { dataTransfer: transfer }));
    fixture.detectChanges();
    expect(ids()).toEqual([2, 3, 1]);
  });

  it('«Añadir» pide abrir la biblioteca', () => {
    const { fixture, el } = setup();
    ([...el.querySelectorAll('button')].find(b => b.textContent?.includes('Añadir')) as HTMLButtonElement).click();
    expect(fixture.componentInstance.added).toBe(1);
  });
});
