/**
 * Escala «redonda» para un eje: el máximo sube al siguiente 1, 2, 5 o 10 × 10ⁿ y se dan `ticks`
 * marcas equidistantes desde 0. Con todo a cero, la escala es 0–1 para no dividir entre cero.
 */
export function niceScale(max: number, ticks = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const rough = max / ticks;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 5, 10].map(f => f * power).find(s => s >= rough) ?? 10 * power;
  const top = Math.ceil(max / step) * step;
  const marks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) marks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, ticks: marks };
}
