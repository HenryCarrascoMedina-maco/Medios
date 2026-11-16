import { niceScale } from './chart';
import { publishNotificationText } from './notification-text';
import { selectRange } from './selection';
import { normalizeTag, parseTags, tagDiff } from './tags';

describe('selectRange (Mayús+clic)', () => {
  const order = [1, 2, 3, 4, 5];

  it('sin Mayús alterna solo el pulsado', () => {
    expect([...selectRange(order, new Set([1]), 1, 3, false)]).toEqual([1, 3]);
    expect([...selectRange(order, new Set([1, 3]), 1, 3, false)]).toEqual([1]);
  });

  it('con Mayús marca el tramo entre el ancla y el pulsado, en cualquier dirección', () => {
    expect([...selectRange(order, new Set([2]), 2, 4, true)].sort()).toEqual([2, 3, 4]);
    expect([...selectRange(order, new Set([4]), 4, 1, true)].sort()).toEqual([1, 2, 3, 4]);
  });

  it('con Mayús sobre uno marcado desmarca el tramo', () => {
    expect([...selectRange(order, new Set([1, 2, 3, 4]), 1, 3, true)]).toEqual([4]);
  });

  it('sin ancla válida se comporta como un clic normal', () => {
    expect([...selectRange(order, new Set(), null, 2, true)]).toEqual([2]);
    expect([...selectRange(order, new Set(), 99, 2, true)]).toEqual([2]);
  });
});

describe('tags', () => {
  it('normalizeTag como el servidor', () => {
    expect(normalizeTag('  #Recetas Rápidas ')).toBe('recetas-rápidas');
    expect(normalizeTag('##Cocina')).toBe('cocina');
  });

  it('parseTags separa por comas, sin vacíos ni repetidos', () => {
    expect(parseTags('Cocina, #cocina, , Baño nuevo')).toEqual(['cocina', 'baño-nuevo']);
  });

  it('tagDiff calcula qué añadir y qué quitar', () => {
    expect(tagDiff(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
    expect(tagDiff(['a'], ['a'])).toEqual({ add: [], remove: [] });
  });
});

describe('niceScale', () => {
  it('redondea el máximo a 1/2/5 × 10ⁿ con marcas equidistantes', () => {
    expect(niceScale(7)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
    expect(niceScale(37).max).toBe(40);
    expect(niceScale(120).ticks[1]).toBe(50);
  });

  it('todo a cero no divide entre cero', () => {
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
  });
});

describe('publishNotificationText', () => {
  it('textos para publicado, fallido y por revisar', () => {
    expect(publishNotificationText('DONE', 'YouTube', 'Grifo')).toEqual({ title: 'Publicado en YouTube', body: '«Grifo» ya está publicado.' });
    expect(publishNotificationText('FAILED', 'TikTok', null)?.body).toContain('El video no se pudo publicar');
    expect(publishNotificationText('NEEDS_REVIEW', 'Instagram', null)?.title).toBe('Revisa la publicación en Instagram');
  });

  it('los demás estados no avisan', () => {
    expect(publishNotificationText('UPLOADING', 'YouTube', 'x')).toBeNull();
  });
});
