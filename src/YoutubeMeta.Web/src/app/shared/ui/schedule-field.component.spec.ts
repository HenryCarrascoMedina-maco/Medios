import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CLOCK_TICK_MS, ClockService } from '@core/services/clock.service';
import { toLocalInput } from '@core/utils/format';
import { ScheduleFieldComponent } from './schedule-field.component';

@Component({
  imports: [ScheduleFieldComponent],
  template: `
    <ym-schedule-field inputId="at-1" hint="opcional · prueba" [minLeadMs]="lead()" [(value)]="value">
      <p class="hint">Ayuda extra</p>
    </ym-schedule-field>
  `
})
class HostComponent {
  readonly value = signal('');
  readonly lead = signal(60_000);
}

describe('ScheduleFieldComponent', () => {
  const START = new Date(2026, 10, 15, 10, 0, 0).getTime();
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let input: () => HTMLInputElement;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(START);
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    input = () => fixture.nativeElement.querySelector('input') as HTMLInputElement;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('enlaza la etiqueta con el campo y muestra la ayuda y el contenido proyectado', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('label')?.getAttribute('for')).toBe('at-1');
    expect(input().id).toBe('at-1');
    expect(input().type).toBe('datetime-local');
    expect(el.textContent).toContain('opcional · prueba');
    expect(el.textContent).toContain('Ayuda extra');
  });

  it('la fecha mínima es ahora + antelación', () => {
    expect(input().min).toBe(toLocalInput(new Date(START + 60_000)));
    host.lead.set(11 * 60_000);
    fixture.detectChanges();
    expect(input().min).toBe(toLocalInput(new Date(START + 11 * 60_000)));
  });

  it('la fecha mínima avanza sola con el reloj compartido', () => {
    jest.advanceTimersByTime(CLOCK_TICK_MS * 4); // 2 minutos
    fixture.detectChanges();
    expect(input().min).toBe(toLocalInput(new Date(START + CLOCK_TICK_MS * 4 + 60_000)));
    expect(TestBed.inject(ClockService).now()).toBe(START + CLOCK_TICK_MS * 4);
  });

  it('escribir actualiza el valor enlazado (two-way) y «Quitar» lo vacía', () => {
    input().value = '2026-11-20T09:30';
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.value()).toBe('2026-11-20T09:30');

    const clear = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b => b.textContent?.includes('Quitar'))!;
    clear.click();
    fixture.detectChanges();
    expect(host.value()).toBe('');
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('un valor externo se refleja en el campo', () => {
    host.value.set('2026-12-01T08:00');
    fixture.detectChanges();
    expect(input().value).toBe('2026-12-01T08:00');
  });
});
