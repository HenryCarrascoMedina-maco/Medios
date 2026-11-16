import {
  formatDateDmy, insertAt, resolveTemplate, templateFields, templateProblems, tokenRangeAt, tokenTouching, tokenize, truncateText, unknownBlocks, variablesFor
} from './template-vars';

const DATE = new Date(2026, 10, 5, 10, 30);

describe('template-vars', () => {
  it('resuelve {titulo}, {fecha} y {firma_cuenta}', () => {
    const text = resolveTemplate('{titulo} — {fecha}\n{firma_cuenta}', { title: 'Grifo nuevo', date: DATE, signature: '— Cocinas Ana' });
    expect(text).toBe('Grifo nuevo — 05/11/2026\n— Cocinas Ana');
  });

  it('repite cada variable todas las veces que aparece', () => {
    expect(resolveTemplate('{titulo} {titulo}', { title: 'A', date: DATE })).toBe('A A');
  });

  it('sin firma no deja líneas en blanco al final', () => {
    expect(resolveTemplate('Texto\n\n{firma_cuenta}', { title: '', date: DATE, signature: null })).toBe('Texto');
  });

  it('expande #bloque:nombre y las variables que lleve dentro', () => {
    const text = resolveTemplate('Mira esto #bloque:redes', { title: 'Video', date: DATE, blocks: { redes: '#cocina {titulo}' } });
    expect(text).toBe('Mira esto #cocina Video');
  });

  it('los bloques no se anidan y uno inexistente queda tal cual', () => {
    const blocks = { a: '#bloque:b', b: 'B' };
    expect(resolveTemplate('#bloque:a #bloque:x', { title: '', date: DATE, blocks })).toBe('#bloque:b #bloque:x');
  });

  it('vacío o null da cadena vacía', () => {
    expect(resolveTemplate(null, { title: 'x', date: DATE })).toBe('');
  });

  it('unknownBlocks lista los bloques que no existen, sin repetir', () => {
    expect(unknownBlocks('#bloque:a #bloque:x #bloque:x #bloque:y', { a: '1' })).toEqual(['x', 'y']);
    expect(unknownBlocks(null, {})).toEqual([]);
  });

  it('{cuenta}, {nombre} y los campos a completar', () => {
    const text = resolveTemplate('Hola {nombre}, soy {cuenta}. Precio: {?precio}', { date: DATE, account: 'Kaltrum', contact: 'María', fields: { precio: '$49' } });
    expect(text).toBe('Hola María, soy Kaltrum. Precio: $49');
  });

  it('sin nombre del cliente, {nombre} desaparece con su espacio', () => {
    expect(resolveTemplate('Hola {nombre} 👋', { date: DATE, contact: null })).toBe('Hola 👋');
    expect(resolveTemplate('Hola {nombre}, ¿qué tal?', { date: DATE })).toBe('Hola, ¿qué tal?');
  });

  it('un campo sin valor queda tal cual', () => {
    expect(resolveTemplate('Precio: {?precio}', { date: DATE, fields: { precio: '  ' } })).toBe('Precio: {?precio}');
  });

  it('tokenize separa texto y etiquetas, y marca las que no valen', () => {
    const kinds = tokenize('Hola {nombre} {?precio} #bloque:redes #bloque:x {otra} {titulo}', { usage: 'REPLY', blocks: ['redes'] })
      .filter(s => s.kind !== 'text').map(s => `${s.text}:${s.kind}`);
    expect(kinds).toEqual(['{nombre}:var', '{?precio}:field', '#bloque:redes:block', '#bloque:x:bad', '{otra}:bad', '{titulo}:bad']);
  });

  it('templateProblems explica cada etiqueta mala una vez', () => {
    expect(templateProblems('{nombre} {nombre} {xx}', { usage: 'PUBLISH' })).toEqual(['{nombre} solo vale en respuestas', '{xx} no es una etiqueta']);
    expect(templateProblems('{titulo}', { usage: 'PUBLISH' })).toEqual([]);
  });

  it('templateFields lista los campos en orden y sin repetir', () => {
    expect(templateFields('{?producto} cuesta {?precio}', 'Otra vez {?precio}', null)).toEqual(['producto', 'precio']);
  });

  it('las etiquetas se tratan como una pieza', () => {
    const text = 'Hola {nombre}!';
    expect(tokenRangeAt(text, 8)).toEqual({ start: 5, end: 13 });
    expect(tokenRangeAt(text, 5)).toBeNull();
    expect(tokenTouching(text, 13, 'before')).toEqual({ start: 5, end: 13 });
    expect(tokenTouching(text, 5, 'after')).toEqual({ start: 5, end: 13 });
    expect(tokenTouching(text, 14, 'before')).toBeNull();
  });

  it('cada uso ofrece sus etiquetas', () => {
    expect(variablesFor('REPLY').map(v => v.token)).toEqual(['{cuenta}', '{nombre}', '{fecha}']);
    expect(variablesFor('PUBLISH').map(v => v.token)).toEqual(['{titulo}', '{cuenta}', '{firma_cuenta}', '{fecha}']);
  });

  it('insertAt inserta en el cursor, reemplaza la selección o añade al final', () => {
    expect(insertAt('Hola mundo', '{titulo} ', 5)).toEqual({ text: 'Hola {titulo} mundo', caret: 14 });
    expect(insertAt('Hola mundo', 'X', 5, 10)).toEqual({ text: 'Hola X', caret: 6 });
    expect(insertAt('Hola', '!', null)).toEqual({ text: 'Hola!', caret: 5 });
  });

  it('truncateText recorta con puntos suspensivos sin pasar del límite', () => {
    expect(truncateText('corto', 10)).toBe('corto');
    const cut = truncateText('una frase bastante larga', 10);
    expect(cut.length).toBeLessThanOrEqual(10);
    expect(cut.endsWith('…')).toBe(true);
    expect(truncateText('abc', 0)).toBe('');
  });

  it('formatDateDmy da dd/MM/yyyy', () => {
    expect(formatDateDmy(new Date(2026, 0, 3))).toBe('03/01/2026');
  });
});
