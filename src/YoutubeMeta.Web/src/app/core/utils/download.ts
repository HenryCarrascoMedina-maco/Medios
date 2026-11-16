import { dayKey } from './dates';

/** Descarga un blob como archivo (p. ej. un CSV pedido con token). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** «publicaciones-2026-11-15.csv» */
export function datedFileName(prefix: string, extension: string, date = new Date()): string {
  return `${prefix}-${dayKey(date)}.${extension}`;
}
