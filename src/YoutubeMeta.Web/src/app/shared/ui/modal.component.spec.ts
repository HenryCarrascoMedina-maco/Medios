import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmService } from '@core/services/confirm.service';
import { ModalComponent } from './modal.component';

@Component({
  imports: [ModalComponent],
  template: `
    <button id="opener">Abrir</button>
    @if (outer()) {
      <ym-modal title="Fuera" [dirty]="dirty()" (closed)="outer.set(false)">
        <input id="outer-input" />
      </ym-modal>
    }
    @if (inner()) {
      <ym-modal title="Dentro" (closed)="inner.set(false)"><button id="inner-btn">OK</button></ym-modal>
    }
  `
})
class HostComponent {
  readonly outer = signal(false);
  readonly inner = signal(false);
  readonly dirty = signal(false);
}

describe('ModalComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let confirm: { ask: jest.Mock };

  const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

  beforeEach(() => {
    confirm = { ask: jest.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: ConfirmService, useValue: confirm }] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('tiene role="dialog", aria-modal y título enlazado', () => {
    host.outer.set(true);
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!);
    expect(title?.textContent).toBe('Fuera');
  });

  it('Escape cierra solo el modal de arriba', () => {
    host.outer.set(true);
    host.inner.set(true);
    fixture.detectChanges();

    escape();
    fixture.detectChanges();
    expect(host.inner()).toBe(false);
    expect(host.outer()).toBe(true);

    escape();
    fixture.detectChanges();
    expect(host.outer()).toBe(false);
  });

  it('con cambios pide confirmación y no cierra si se rechaza', async () => {
    host.outer.set(true);
    host.dirty.set(true);
    fixture.detectChanges();

    confirm.ask.mockResolvedValue(false);
    escape();
    await Promise.resolve();
    fixture.detectChanges();
    expect(confirm.ask).toHaveBeenCalledTimes(1);
    expect(host.outer()).toBe(true);

    confirm.ask.mockResolvedValue(true);
    escape();
    await Promise.resolve();
    fixture.detectChanges();
    expect(host.outer()).toBe(false);
  });

  it('sin cambios cierra sin preguntar', () => {
    host.outer.set(true);
    fixture.detectChanges();
    escape();
    fixture.detectChanges();
    expect(confirm.ask).not.toHaveBeenCalled();
    expect(host.outer()).toBe(false);
  });

  it('devuelve el foco al elemento que lo tenía al abrir', () => {
    const opener = fixture.nativeElement.querySelector('#opener') as HTMLButtonElement;
    opener.focus();
    host.outer.set(true);
    fixture.detectChanges();
    expect(document.activeElement).not.toBe(opener);

    host.outer.set(false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(opener);
  });
});
