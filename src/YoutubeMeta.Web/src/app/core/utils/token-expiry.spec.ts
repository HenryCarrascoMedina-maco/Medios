import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClockService } from '../services/clock.service';
import { TokenExpiryChipComponent } from '@shared/ui/token-expiry-chip.component';
import { tokenExpiry } from './token-expiry';

const NOW = new Date('2026-11-15T10:00:00Z').getTime();
const DAY = 24 * 3600_000;
const at = (ms: number) => new Date(NOW + ms).toISOString();

describe('tokenExpiry', () => {
  it('nada si no hay fecha, es inválida o falta mucho', () => {
    expect(tokenExpiry(null, NOW)).toBeNull();
    expect(tokenExpiry('no-es-fecha', NOW)).toBeNull();
    expect(tokenExpiry(at(30 * DAY), NOW)).toBeNull();
    expect(tokenExpiry(at(10 * DAY + 3600_000), NOW)).toBeNull();
  });

  it('«Caduca en N días» desde 10 días antes', () => {
    expect(tokenExpiry(at(10 * DAY), NOW)).toMatchObject({ label: 'Caduca en 10 días', tone: 'warning', expired: false, days: 10 });
    expect(tokenExpiry(at(3 * DAY), NOW)).toMatchObject({ label: 'Caduca en 3 días', tone: 'danger' });
  });

  it('mañana y hoy', () => {
    expect(tokenExpiry(at(DAY - 1000), NOW)?.label).toBe('Caduca mañana');
    expect(tokenExpiry(at(3600_000), NOW)?.label).toBe('Caduca hoy');
  });

  it('«Caducada · Reconectar» cuando ya pasó', () => {
    expect(tokenExpiry(at(-2 * DAY), NOW)).toMatchObject({ label: 'Caducada · Reconectar', tone: 'danger', expired: true, days: -2 });
    expect(tokenExpiry(at(0), NOW)?.expired).toBe(true);
  });

  it('el umbral se puede cambiar', () => {
    expect(tokenExpiry(at(15 * DAY), NOW, 20)?.label).toBe('Caduca en 15 días');
  });
});

describe('TokenExpiryChipComponent', () => {
  const render = (expiresAt: string | null) => {
    TestBed.configureTestingModule({ providers: [{ provide: ClockService, useValue: { now: signal(NOW) } }] });
    const fixture = TestBed.createComponent(TokenExpiryChipComponent);
    fixture.componentRef.setInput('expiresAt', expiresAt);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent?.trim() ?? '';
  };

  afterEach(() => TestBed.resetTestingModule());

  it('muestra el aviso o nada', () => {
    expect(render(at(9 * DAY))).toContain('Caduca en 9 días');
    TestBed.resetTestingModule();
    expect(render(at(-DAY))).toContain('Caducada · Reconectar');
    TestBed.resetTestingModule();
    expect(render(at(40 * DAY))).toBe('');
  });
});
