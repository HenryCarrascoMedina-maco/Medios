import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IVideo } from '@core/models/api.models';
import { PosterService } from '@core/services/poster.service';
import { VideoCardComponent } from './video-card.component';

const video: IVideo = {
  id: 3, title: 'Grifo', originalFileName: 'g.mp4', contentType: 'video/mp4', sizeBytes: 1024, durationSec: 30, width: 1920, height: 1080,
  hasPoster: false, createdBy: 'admin', createdAt: '', tags: ['cocina', 'baño'], publications: []
};

describe('VideoCardComponent', () => {
  const setup = (selecting: boolean) => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: PosterService, useValue: { get: () => Promise.resolve(null), revision: () => 0 } }] });
    const fixture = TestBed.createComponent(VideoCardComponent);
    fixture.componentRef.setInput('video', video);
    fixture.componentRef.setInput('selecting', selecting);
    fixture.detectChanges();
    const toggled: boolean[] = [];
    fixture.componentInstance.toggled.subscribe(shift => toggled.push(shift));
    return { fixture, el: fixture.nativeElement as HTMLElement, toggled };
  };

  afterEach(() => TestBed.resetTestingModule());

  it('muestra las etiquetas', () => {
    const { el } = setup(false);
    expect(el.textContent).toContain('#cocina');
    expect(el.textContent).toContain('#baño');
  });

  it('fuera del modo selección, un clic normal navega (no alterna)', () => {
    const { el, toggled } = setup(false);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    el.querySelector('a')!.dispatchEvent(click);
    expect(toggled).toEqual([]);
  });

  it('en modo selección un clic alterna y no navega; Mayús indica tramo', () => {
    const { el, toggled } = setup(true);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    el.querySelector('a')!.dispatchEvent(click);
    el.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
    expect(click.defaultPrevented).toBe(true);
    expect(toggled).toEqual([false, true]);
  });

  it('la casilla tiene nombre accesible', () => {
    const { el } = setup(false);
    expect(el.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')).toBe('Seleccionar Grifo');
  });
});
