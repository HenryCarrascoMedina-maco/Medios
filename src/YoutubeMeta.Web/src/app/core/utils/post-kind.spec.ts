import { inferPostKind, isLinkedinPage, isTeamsWebhook, isValidLink, linkHost, mediaKindOf, mediaKindOfFile } from './post-kind';

const v = { mediaKind: 'VIDEO' as const };
const i = { mediaKind: 'IMAGE' as const };
const d = { mediaKind: 'DOCUMENT' as const };

describe('post-kind', () => {
  it('sin medios: texto o enlace', () => {
    expect(inferPostKind([])).toEqual({ kind: 'TEXT', error: null });
    expect(inferPostKind([], '  ')).toEqual({ kind: 'TEXT', error: null });
    expect(inferPostKind([], 'https://a.com')).toEqual({ kind: 'LINK', error: null });
  });

  it('una imagen, carrusel, video y PDF', () => {
    expect(inferPostKind([i]).kind).toBe('IMAGE');
    expect(inferPostKind([i, i, i]).kind).toBe('CAROUSEL');
    expect(inferPostKind([v]).kind).toBe('VIDEO');
    expect(inferPostKind([d]).kind).toBe('DOCUMENT');
  });

  it('combinaciones no válidas dicen por qué', () => {
    expect(inferPostKind([i, v])).toEqual({ kind: null, error: expect.stringContaining('no se pueden mezclar') });
    expect(inferPostKind([v, v]).error).toContain('un video');
    expect(inferPostKind([d, d]).error).toContain('un PDF');
    expect(inferPostKind([i], 'https://a.com').error).toContain('sin medios');
  });

  it('sin mediaKind (respuestas antiguas) es un video', () => {
    expect(mediaKindOf({})).toBe('VIDEO');
    expect(mediaKindOf(null)).toBe('VIDEO');
    expect(inferPostKind([{}]).kind).toBe('VIDEO');
  });

  it('tipo de archivo por extensión', () => {
    expect(mediaKindOfFile('Foto.JPG')).toBe('IMAGE');
    expect(mediaKindOfFile('a.jpeg')).toBe('IMAGE');
    expect(mediaKindOfFile('a.png')).toBe('IMAGE');
    expect(mediaKindOfFile('caso.pdf')).toBe('DOCUMENT');
    expect(mediaKindOfFile('demo.mp4')).toBe('VIDEO');
  });

  it('enlaces válidos y su dominio', () => {
    expect(isValidLink('https://kaltrum.com/v2')).toBe(true);
    expect(isValidLink('http://www.a.es')).toBe(true);
    expect(isValidLink('ftp://a.com')).toBe(false);
    expect(isValidLink('kaltrum')).toBe(false);
    expect(isValidLink('https://localhost')).toBe(false);
    expect(linkHost('https://www.kaltrum.com/x')).toBe('kaltrum.com');
  });

  it('página de empresa de LinkedIn por accountHint o URN', () => {
    expect(isLinkedinPage({ platform: 'LINKEDIN', accountHint: 'Página de empresa', externalId: '1' })).toBe(true);
    expect(isLinkedinPage({ platform: 'LINKEDIN', accountHint: null, externalId: 'urn:li:organization:5' })).toBe(true);
    expect(isLinkedinPage({ platform: 'LINKEDIN', accountHint: 'Perfil personal', externalId: 'abc' })).toBe(false);
    expect(isLinkedinPage({ platform: 'FACEBOOK', accountHint: 'Página de empresa', externalId: '1' })).toBe(false);
  });
});

describe('isTeamsWebhook', () => {
  it('distingue el canal por webhook del de Graph', () => {
    expect(isTeamsWebhook({ platform: 'TEAMS', externalId: 'webhook:abc' })).toBe(true);
    expect(isTeamsWebhook({ platform: 'TEAMS', externalId: 'team/channel' })).toBe(false);
    expect(isTeamsWebhook({ platform: 'TELEGRAM', externalId: 'webhook:abc' })).toBe(false);
  });
});
