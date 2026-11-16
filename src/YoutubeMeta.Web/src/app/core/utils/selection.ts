/** Copia del conjunto con `item` añadido o quitado (para signals de Set). */
export function toggled<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set);
  next.has(item) ? next.delete(item) : next.add(item);
  return next;
}

/**
 * Selección con Mayús: marca (o desmarca) todo el tramo entre el último elemento pulsado (`anchor`)
 * y el actual, en el orden en que se ven. Sin ancla o si no está en la lista, alterna solo el actual.
 */
export function selectRange<T>(order: readonly T[], selected: ReadonlySet<T>, anchor: T | null, target: T, shift: boolean): Set<T> {
  const next = new Set(selected);
  const from = anchor == null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(target);
  if (!shift || from < 0 || to < 0) return toggled(selected, target);
  // El tramo toma el estado que va a tener el elemento pulsado.
  const select = !selected.has(target);
  const [a, b] = from < to ? [from, to] : [to, from];
  for (const item of order.slice(a, b + 1)) select ? next.add(item) : next.delete(item);
  return next;
}
