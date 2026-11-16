import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Platform, PublicationStatus } from '@core/models/api.models';
import { StatusChipComponent } from './status-chip.component';

describe('StatusChipComponent', () => {
  let fixture: ComponentFixture<StatusChipComponent>;

  const render = (inputs: { status?: PublicationStatus | null; platform?: Platform | null; account?: string | null; percent?: number | null }) => {
    fixture = TestBed.createComponent(StatusChipComponent);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  const chip = (el: HTMLElement) => el.querySelector('ym-chip') as HTMLElement;

  it('sin estado muestra «Sin publicar» con tono de contorno', () => {
    const el = render({ status: null });
    expect(el.textContent).toContain('Sin publicar');
    expect(chip(el).className).toContain('border');
  });

  it('subiendo con porcentaje lo muestra en el texto', () => {
    const el = render({ status: 'UPLOADING', percent: 42 });
    expect(el.textContent).toContain('Subiendo 42%');
    expect(chip(el).className).toContain('bg-brand-soft');
  });

  it('cada estado tiene su tono', () => {
    expect(chip(render({ status: 'DONE' })).className).toContain('bg-green-100');
    expect(chip(render({ status: 'FAILED' })).className).toContain('bg-red-100');
    expect(chip(render({ status: 'WAITING_QUOTA' })).className).toContain('bg-amber-100');
  });

  it('con plataforma y cuenta: glifo SVG, nombre y título accesible', () => {
    const el = render({ status: 'DONE', platform: 'YOUTUBE', account: 'Canal A' });
    expect(el.querySelector('ym-icon svg')).not.toBeNull();
    expect(el.textContent).toContain('Canal A');
    expect(chip(el).getAttribute('title')).toBe('YouTube · Canal A · Publicado');
  });

  it('sin plataforma no pinta glifo', () => {
    const el = render({ status: 'PENDING' });
    expect(el.querySelector('ym-icon')).toBeNull();
    expect(el.textContent).toContain('En cola');
  });
});
