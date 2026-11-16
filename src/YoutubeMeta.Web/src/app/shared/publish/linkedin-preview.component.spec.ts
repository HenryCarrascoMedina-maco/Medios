import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PosterService } from '@core/services/poster.service';
import { account, image } from '../../testing/page-mocks';
import { LinkedinPreviewComponent } from './linkedin-preview.component';
import { LINKEDIN_FOLD, foldText } from './publish.models';

describe('foldText (corte de «…ver más»)', () => {
  it('un texto corto se ve entero', () => {
    expect(foldText('Hola')).toEqual({ shown: 'Hola', more: false });
    expect(foldText('x'.repeat(LINKEDIN_FOLD)).more).toBe(false);
  });

  it('corta a ~210 caracteres sin partir palabras', () => {
    const text = 'palabra '.repeat(40);
    const { shown, more } = foldText(text);
    expect(more).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(LINKEDIN_FOLD);
    expect(shown.endsWith('palabra')).toBe(true);
  });

  it('sin espacios cerca del corte, corta en seco', () => {
    expect(foldText('x'.repeat(300)).shown).toHaveLength(LINKEDIN_FOLD);
  });
});

describe('LinkedinPreviewComponent', () => {
  const render = (text: string, media = [image(1), image(2), image(3), image(4), image(5)]) => {
    TestBed.configureTestingModule({ providers: [{ provide: PosterService, useValue: { get: () => Promise.resolve(null), revision: signal(0) } }] });
    const fixture = TestBed.createComponent(LinkedinPreviewComponent);
    fixture.componentRef.setInput('account', account('LINKEDIN', 1, { displayName: 'Henry Carrasco' }));
    fixture.componentRef.setInput('text', text);
    fixture.componentRef.setInput('media', media);
    fixture.componentRef.setInput('kind', media.length > 1 ? 'CAROUSEL' : media.length ? 'IMAGE' : 'TEXT');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  afterEach(() => TestBed.resetTestingModule());

  it('marca «…ver más» y enseña la cuadrícula con +N', () => {
    const el = render('Aprendizaje '.repeat(30));
    expect(el.textContent).toContain('ver más');
    expect(el.textContent).toContain('Henry Carrasco');
    expect(el.querySelectorAll('ym-media-thumb').length).toBe(4);
    expect(el.textContent).toContain('+1');
  });

  it('texto corto sin medios: sin «ver más» ni cuadrícula', () => {
    const el = render('Hola', []);
    expect(el.textContent).not.toContain('ver más');
    expect(el.querySelectorAll('ym-media-thumb').length).toBe(0);
  });
});
