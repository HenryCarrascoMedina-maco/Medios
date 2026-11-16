import { HttpErrorResponse } from '@angular/common/http';
import { dayKey } from './dates';

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toLocaleString('es', { maximumFractionDigits: exponent >= 3 ? 2 : 0 })} ${units[exponent]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return '--:--';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

/** Vertical o cuadrado y hasta 3 min: YouTube lo clasifica como Short. */
export function isShort(width: number | null, height: number | null, durationSec: number | null): boolean {
  return width != null && height != null && durationSec != null && height >= width && durationSec <= 180;
}

/** Mensaje legible de un error del back (texto plano de BadRequest, ProblemDetails o sin conexión). */
export function apiError(error: unknown, fallback = 'No se pudo completar la operación.'): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;
  if (error.status === 0) return 'Sin conexión con el servidor.';
  const body = error.error;
  // El texto del servidor manda (p. ej. «Demasiados intentos fallidos. Espera N min…» del login).
  if (typeof body === 'string' && body.trim().length > 0) return body;
  if (body?.message && typeof body.message === 'string') return body.message;
  if (body?.text && typeof body.text === 'string') return body.text;
  if (body?.title && typeof body.title === 'string') return body.title;
  if (error.status === 429) return 'Demasiados intentos. Espera un minuto.';
  return fallback;
}

/** Cuenta atrás «m:ss» (p. ej. 4:59). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function utf8Bytes(value: string | null | undefined): number {
  return value ? new TextEncoder().encode(value).length : 0;
}

/** Texto para buscar sin distinguir mayúsculas ni tildes («Grifería» encuentra «griferia»). */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Valor para <input type="datetime-local"> (hora local). */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** «hace 5 min», «hace 3 h», «hace 2 días»; null o fecha inválida → «nunca». */
export function formatAgo(iso: string | null | undefined, now = Date.now()): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(at)) return 'nunca';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} días`;
}

/** Porcentaje 0–100 con un decimal (0 si no hay total). */
export function percentOf(value: number | null | undefined, total: number | null | undefined): number {
  return value != null && total ? Math.min(100, Math.round((value / total) * 1000) / 10) : 0;
}
