import { TemplateUsage } from '../models/api.models';

/**
 * Etiquetas de las plantillas y bloques de hashtags:
 *   {titulo}        título del video o de la publicación (solo publicaciones)
 *   {fecha}         fecha de publicación o de hoy (dd/MM/yyyy)
 *   {cuenta}        nombre de la cuenta que publica o responde
 *   {firma_cuenta}  firma de la cuenta (Conexiones; solo publicaciones)
 *   {nombre}        nombre del cliente (solo respuestas de la bandeja)
 *   {?campo}        lo que se escriba al usar la plantilla («campo a completar»)
 *   #bloque:nombre  contenido del bloque «nombre» (Ajustes › Plantillas)
 * Los bloques se expanden primero (pueden llevar etiquetas) y no se anidan. Este catálogo es el único: el editor, el
 * resaltado, la revisión y la vista previa salen de aquí.
 */
export interface ITemplateContext {
  title?: string;
  date: Date;
  signature?: string | null;
  /** Nombre de la cuenta ({cuenta}). */
  account?: string | null;
  /** Nombre del cliente ({nombre}). Vacío = desaparece sin dejar un espacio de más. */
  contact?: string | null;
  /** nombre → contenido. */
  blocks?: Readonly<Record<string, string>>;
  /** Valores de los campos a completar ({?campo}); uno sin valor queda tal cual. */
  fields?: Readonly<Record<string, string>>;
}

export type TemplateVariableGroup = 'Del contenido' | 'De la cuenta' | 'Del cliente' | 'Otros';

export interface ITemplateVariable {
  token: string;
  label: string;
  group: TemplateVariableGroup;
  /** Dónde vale: una publicación no conoce al cliente y una respuesta no tiene título de video. */
  usages: readonly TemplateUsage[];
}

const BOTH: readonly TemplateUsage[] = ['PUBLISH', 'REPLY'];

export const TEMPLATE_VARIABLES: readonly ITemplateVariable[] = [
  { token: '{titulo}', label: 'Título del video', group: 'Del contenido', usages: ['PUBLISH'] },
  { token: '{cuenta}', label: 'Nombre de la cuenta', group: 'De la cuenta', usages: BOTH },
  { token: '{firma_cuenta}', label: 'Firma de la cuenta', group: 'De la cuenta', usages: ['PUBLISH'] },
  { token: '{nombre}', label: 'Nombre del cliente', group: 'Del cliente', usages: ['REPLY'] },
  { token: '{fecha}', label: 'Fecha', group: 'Otros', usages: BOTH }
];

/** Nombre de un campo a completar: letras, números y _ (hasta 30). */
export const FIELD_NAME = /^[\p{L}\p{N}_]{1,30}$/u;
const BLOCK = /#bloque:([a-z0-9_-]+)/g;
const FIELD = /\{\?([\p{L}\p{N}_]{1,30})\}/gu;
/** Cualquier etiqueta: campo, variable (conocida o no) o bloque. */
const TOKEN = /\{\?[\p{L}\p{N}_]{1,30}\}|\{[a-z_]{2,30}\}|#bloque:[a-z0-9_-]+/gu;

export type TemplateSegmentKind = 'text' | 'var' | 'field' | 'block' | 'bad';

export interface ITemplateSegment {
  text: string;
  kind: TemplateSegmentKind;
  /** Por qué está mal (variable desconocida, bloque que no existe…). */
  problem?: string;
}

export interface ITokenizeOptions {
  usage?: TemplateUsage;
  /** Bloques que existen; sin la lista, todos se dan por buenos. */
  blocks?: readonly string[];
}

export function formatDateDmy(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Variable `{x}` del catálogo, o null si no existe. */
export function variableOf(token: string): ITemplateVariable | null {
  return TEMPLATE_VARIABLES.find(v => v.token === token) ?? null;
}

/** Variables que se ofrecen para un uso (las demás aparecen apagadas en el menú). */
export function variablesFor(usage: TemplateUsage): ITemplateVariable[] {
  return TEMPLATE_VARIABLES.filter(v => v.usages.includes(usage));
}

/** Texto partido en trozos: texto normal y etiquetas, cada una marcada como buena o con su problema. */
export function tokenize(text: string | null | undefined, options: ITokenizeOptions = {}): ITemplateSegment[] {
  const value = text ?? '';
  const segments: ITemplateSegment[] = [];
  let last = 0;
  for (const match of value.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ text: value.slice(last, at), kind: 'text' });
    segments.push(classify(match[0], options));
    last = at + match[0].length;
  }
  if (last < value.length) segments.push({ text: value.slice(last), kind: 'text' });
  return segments;
}

function classify(token: string, { usage, blocks }: ITokenizeOptions): ITemplateSegment {
  if (token.startsWith('{?')) return { text: token, kind: 'field' };
  if (token.startsWith('#bloque:')) {
    const name = token.slice('#bloque:'.length);
    return blocks && !blocks.includes(name) ? { text: token, kind: 'bad', problem: `No existe el bloque «${name}»` } : { text: token, kind: 'block' };
  }
  const variable = variableOf(token);
  if (!variable) return { text: token, kind: 'bad', problem: `${token} no es una etiqueta` };
  if (usage && !variable.usages.includes(usage))
    return { text: token, kind: 'bad', problem: usage === 'PUBLISH' ? `${token} solo vale en respuestas` : `${token} solo vale en publicaciones` };
  return { text: token, kind: 'var' };
}

/** Etiquetas con problema, sin repetir (para la revisión antes de guardar o enviar). */
export function templateProblems(text: string | null | undefined, options: ITokenizeOptions = {}): string[] {
  return [...new Set(tokenize(text, options).flatMap(s => (s.problem ? [s.problem] : [])))];
}

/** Campos a completar ({?campo}) en orden de aparición, sin repetir. */
export function templateFields(...texts: (string | null | undefined)[]): string[] {
  const names = new Set<string>();
  for (const text of texts) for (const match of (text ?? '').matchAll(FIELD)) names.add(match[1]);
  return [...names];
}

/** Dónde empieza y acaba la etiqueta que contiene `position` (estrictamente dentro), para tratarla como una pieza. */
export function tokenRangeAt(text: string, position: number): { start: number; end: number } | null {
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (position > start && position < end) return { start, end };
    if (start >= position) break;
  }
  return null;
}

/** La etiqueta que acaba justo en `position` (Retroceso) o empieza justo ahí (Suprimir). */
export function tokenTouching(text: string, position: number, side: 'before' | 'after'): { start: number; end: number } | null {
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (side === 'before' ? end === position : start === position) return { start, end };
    if (start > position) break;
  }
  return null;
}

export function resolveTemplate(text: string | null | undefined, ctx: ITemplateContext): string {
  if (!text) return '';
  const blocks = ctx.blocks ?? {};
  const fields = ctx.fields ?? {};
  const contact = ctx.contact?.trim() ?? '';
  return text
    .replace(BLOCK, (match, name: string) => blocks[name] ?? match)
    .replace(FIELD, (match, name: string) => fields[name]?.trim() || match)
    // Con función: un «$» en los valores ($49) no se interpreta como patrón de reemplazo.
    .replace(/\{titulo\}/g, () => ctx.title ?? '')
    .replace(/\{fecha\}/g, () => formatDateDmy(ctx.date))
    .replace(/\{cuenta\}/g, () => ctx.account?.trim() ?? '')
    // Sin nombre: «Hola {nombre} 👋» → «Hola 👋» (se va también el espacio de delante).
    .replace(/ ?\{nombre\}/g, match => (contact ? match.replace('{nombre}', () => contact) : ''))
    .replace(/\{firma_cuenta\}/g, () => ctx.signature?.trim() ?? '')
    // Si la firma estaba vacía no deja líneas en blanco de más al final.
    .replace(/\s+$/, '');
}

/** Bloques usados en el texto que no existen (se avisa antes de publicar). */
export function unknownBlocks(text: string | null | undefined, blocks: Readonly<Record<string, string>>): string[] {
  const missing = new Set<string>();
  for (const match of (text ?? '').matchAll(BLOCK)) if (!(match[1] in blocks)) missing.add(match[1]);
  return [...missing];
}

/** Inserta `token` en la posición del cursor (o al final). Devuelve el texto y la nueva posición. */
export function insertAt(text: string, token: string, start: number | null, end: number | null = start): { text: string; caret: number } {
  const from = start ?? text.length;
  const to = end ?? from;
  return { text: text.slice(0, from) + token + text.slice(to), caret: from + token.length };
}

/** Recorta a `max` caracteres con «…» (vista previa: lo que mostraría la plataforma). */
export function truncateText(text: string, max: number): string {
  if (max <= 0) return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
