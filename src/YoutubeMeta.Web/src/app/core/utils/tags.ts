/**
 * Etiquetas de la biblioteca, normalizadas igual que el servidor: minúsculas, sin #, espacios → -.
 * Así lo que se ve antes de guardar coincide con lo que queda guardado.
 */
export function normalizeTag(value: string): string {
  return value.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-');
}

/** «Cocina, #Recetas rápidas» → ['cocina', 'recetas-rapidas']: separa por comas, sin vacíos ni repetidos. */
export function parseTags(value: string): string[] {
  return [...new Set(value.split(',').map(normalizeTag).filter(Boolean))];
}

/** Cambios para pasar de `before` a `after` (lo que espera POST /api/Video/Tags). */
export function tagDiff(before: readonly string[], after: readonly string[]): { add: string[]; remove: string[] } {
  return { add: after.filter(t => !before.includes(t)), remove: before.filter(t => !after.includes(t)) };
}
