import type { ChipTone } from '@shared/ui/chip.component';
import { DAY_MS } from './dates';

/** Días antes de caducar en los que se empieza a avisar. */
export const TOKEN_WARN_DAYS = 10;

export interface ITokenExpiry {
  label: string;
  tone: ChipTone;
  expired: boolean;
  /** Días que faltan (0 = caduca hoy; negativo = ya caducó). */
  days: number;
}

/**
 * Aviso de caducidad de un acceso que no se renueva solo (LinkedIn, 60 días): null si falta más de
 * `warnDays`, «Caduca en N días» si queda poco y «Caducada · Reconectar» si ya pasó.
 */
export function tokenExpiry(expiresAt: string | null | undefined, now: number, warnDays = TOKEN_WARN_DAYS): ITokenExpiry | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return null;
  if (at <= now) return { label: 'Caducada · Reconectar', tone: 'danger', expired: true, days: -Math.ceil((now - at) / DAY_MS) };
  const days = Math.ceil((at - now) / DAY_MS);
  if (days > warnDays) return null;
  const label = days <= 1 ? (at - now < DAY_MS / 2 ? 'Caduca hoy' : 'Caduca mañana') : `Caduca en ${days} días`;
  return { label, tone: days <= 3 ? 'danger' : 'warning', expired: false, days };
}
