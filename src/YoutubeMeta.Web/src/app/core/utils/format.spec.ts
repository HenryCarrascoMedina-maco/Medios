import { HttpErrorResponse } from '@angular/common/http';
import { apiError, formatAgo, formatBytes, formatCountdown, formatDuration, isShort, normalizeText, percentOf, toLocalInput, utf8Bytes } from './format';

describe('format', () => {
  it('formatBytes usa la unidad adecuada y el formato español', () => {
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1,5 GB');
  });

  it('formatDuration muestra m:ss o h:mm:ss', () => {
    expect(formatDuration(null)).toBe('--:--');
    expect(formatDuration(Infinity)).toBe('--:--');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('formatCountdown redondea hacia arriba y no baja de 0:00', () => {
    expect(formatCountdown(299_001)).toBe('5:00');
    expect(formatCountdown(299_000)).toBe('4:59');
    expect(formatCountdown(9_000)).toBe('0:09');
    expect(formatCountdown(-5)).toBe('0:00');
  });

  it('isShort: vertical o cuadrado y hasta 3 minutos', () => {
    expect(isShort(1080, 1920, 60)).toBe(true);
    expect(isShort(1080, 1080, 180)).toBe(true);
    expect(isShort(1920, 1080, 60)).toBe(false);
    expect(isShort(1080, 1920, 181)).toBe(false);
    expect(isShort(null, 1920, 60)).toBe(false);
  });

  it('utf8Bytes cuenta bytes, no caracteres', () => {
    expect(utf8Bytes('ñ')).toBe(2);
    expect(utf8Bytes('')).toBe(0);
    expect(utf8Bytes(null)).toBe(0);
  });

  it('normalizeText ignora tildes, mayúsculas y espacios de los extremos', () => {
    expect(normalizeText('  Grifería BAÑO ')).toBe('griferia bano');
    expect(normalizeText(null)).toBe('');
  });

  it('toLocalInput da el formato de datetime-local en hora local', () => {
    expect(toLocalInput(new Date(2026, 10, 5, 7, 3))).toBe('2026-11-05T07:03');
  });

  describe('apiError', () => {
    const http = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

    it('sin conexión y demasiados intentos tienen su texto', () => {
      expect(apiError(http(0, null))).toBe('Sin conexión con el servidor.');
      expect(apiError(http(429, null))).toBe('Demasiados intentos. Espera un minuto.');
    });

    it('el texto del servidor manda también en un 429 (bloqueo del login)', () => {
      expect(apiError(http(429, 'Demasiados intentos fallidos. Espera 5 min.'))).toBe('Demasiados intentos fallidos. Espera 5 min.');
      expect(apiError(http(400, { isSuccess: false, message: 'Del sobre' }))).toBe('Del sobre');
    });

    it('usa el texto plano, .text o .title del cuerpo', () => {
      expect(apiError(http(400, 'Título vacío'))).toBe('Título vacío');
      expect(apiError(http(400, { text: 'De text' }))).toBe('De text');
      expect(apiError(http(400, { title: 'De title' }))).toBe('De title');
    });

    it('si no hay nada legible usa el texto por defecto', () => {
      expect(apiError(http(500, null), 'Por defecto')).toBe('Por defecto');
      expect(apiError(new Error('x'), 'Otro')).toBe('Otro');
    });
  });

  it('formatAgo da tiempo relativo', () => {
    const now = Date.parse('2026-11-15T10:00:00Z');
    expect(formatAgo(null, now)).toBe('nunca');
    expect(formatAgo('2026-11-15T09:59:50Z', now)).toBe('ahora mismo');
    expect(formatAgo('2026-11-15T09:55:00Z', now)).toBe('hace 5 min');
    expect(formatAgo('2026-11-15T07:00:00Z', now)).toBe('hace 3 h');
    expect(formatAgo('2026-11-12T10:00:00Z', now)).toBe('hace 3 días');
  });

  it('percentOf con un decimal y tope 100', () => {
    expect(percentOf(1, 3)).toBe(33.3);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(null, 10)).toBe(0);
    expect(percentOf(20, 10)).toBe(100);
  });
});
