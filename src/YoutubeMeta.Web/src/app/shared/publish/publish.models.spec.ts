import { IConnection, IVideo, Platform } from '@core/models/api.models';
import { IPublishContext, draftCounters, draftErrors, finalText, newDraft, staggeredPublishAt, toDestination, toPublicationRequest } from './publish.models';
import { DEFAULT_RULES } from '@core/utils/publication-rules';
import { toLocalInput } from '@core/utils/format';

const NOW = new Date('2026-11-15T10:00:00Z').getTime();

const video: IVideo = {
  id: 7, title: 'Video', originalFileName: 'v.mp4', contentType: 'video/mp4', sizeBytes: 1024, durationSec: 30,
  width: 1920, height: 1080, hasPoster: false, createdBy: 'admin', createdAt: '', publications: []
};

const ctx = (overrides: Partial<IPublishContext> = {}): IPublishContext =>
  ({ media: [video], kind: 'VIDEO', title: 'Común', description: 'Desc común', madeForKids: false, synthetic: false, now: NOW, ...overrides });

const account = (platform: Platform, id = 1): IConnection => ({
  id, platform, externalId: 'x', displayName: 'Cuenta', alias: null, avatarUrl: null, accountHint: null, scopes: null, tokenExpiresAt: null,
  statusCode: 'CONNECTED', statusMessage: null, isDefault: false, credentialId: null, credentialName: null, uploadLimitMb: null,
  connectedBy: 'admin', connectedAt: '', lastUsedAt: null, lastTestAt: null, lastTestOk: null, lastTestMessage: null, revokedAt: null
});

describe('publish.models', () => {
  it('el texto propio de la cuenta sustituye al común', () => {
    const d = { ...newDraft(), title: 'Propio' };
    const dest = toDestination(account('FACEBOOK'), d, ctx());
    expect(dest.title).toBe('Propio');
    expect(dest.description).toBe('Desc común');
  });

  it('YouTube programado se envía como privado con sus campos', () => {
    const d = { ...newDraft(), privacy: 'public' as const, publishAt: '2026-11-20T10:00', categoryId: '26', tags: ' a, b ' };
    const dest = toDestination(account('YOUTUBE'), d, ctx({ synthetic: true, madeForKids: true }));
    expect(dest).toMatchObject({ privacyStatus: 'private', categoryId: '26', tags: 'a, b', madeForKids: true, containsSyntheticMedia: true, options: null });
    expect(dest.publishAt).toBe(new Date('2026-11-20T10:00').toISOString());
  });

  it('cada plataforma lleva solo sus opciones', () => {
    expect(toDestination(account('INSTAGRAM'), newDraft(), ctx()).options).toEqual({ shareToFeed: true });
    expect(toDestination(account('TELEGRAM'), newDraft(), ctx()).options).toEqual({ disableNotification: false, protectContent: false });
    const tiktok = toDestination(account('TIKTOK'), { ...newDraft(), privacy: 'private', commercial: false, brandContent: true }, ctx());
    expect(tiktok.privacyStatus).toBe('private');
    expect(tiktok.options).toMatchObject({ tiktokMode: 'DIRECT', brandContent: false, isAigc: false });
    expect(tiktok.categoryId).toBeNull();
  });

  it('TikTok como borrador no envía privacidad', () => {
    expect(toDestination(account('TIKTOK'), { ...newDraft(), tiktokMode: 'INBOX', privacy: 'public' }, ctx()).privacyStatus).toBeNull();
  });

  it('draftErrors usa «ahora» del contexto (reloj compartido)', () => {
    const d = { ...newDraft(), publishAt: '2026-11-15T10:30' };
    const at = new Date('2026-11-15T10:30').getTime();
    expect(draftErrors(account('INSTAGRAM'), d, ctx({ now: at - 60_000 }), undefined)).toEqual([]);
    expect(draftErrors(account('INSTAGRAM'), d, ctx({ now: at + 60_000 }), undefined)).toContain('la fecha debe ser futura');
  });

  it('TikTok comercial exige indicar de quién es', () => {
    const info = { nickname: 'n', username: null, avatarUrl: null, privacyOptions: ['SELF_ONLY'], commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxDurationSec: 600 };
    const d = { ...newDraft(), privacy: 'private' as const, commercial: true };
    expect(draftErrors(account('TIKTOK'), d, ctx(), info)).toContain('indica de quién es el contenido comercial');
    expect(draftErrors(account('TIKTOK'), { ...d, brandOrganic: true }, ctx(), info)).toEqual([]);
  });

  it('si creator_info falló no se queda «cargando»', () => {
    const errors = draftErrors(account('TIKTOK'), { ...newDraft(), privacy: 'private' }, ctx(), { error: 'TikTok no respondió.' });
    expect(errors).not.toContain('cargando los datos de la cuenta');
  });

  it('draftCounters usa los límites de cada plataforma', () => {
    expect(draftCounters('TIKTOK', newDraft(), ctx())).toBe('texto 5/2200');
    expect(draftCounters('TELEGRAM', newDraft(), ctx())).toBe('texto 10/1024');
    expect(draftCounters('FACEBOOK', newDraft(), ctx())).toBe('título 5/255');
  });

  it('YouTube con lista de reproducción la envía en options.playlistId', () => {
    expect(toDestination(account('YOUTUBE'), { ...newDraft(), playlistId: 'PL1' }, ctx()).options).toEqual({ playlistId: 'PL1' });
  });

  it('staggeredPublishAt suma index × intervalo; vacío sigue vacío', () => {
    const base = '2026-11-20T10:00';
    expect(staggeredPublishAt(base, 0, 3_600_000)).toBe(base);
    expect(staggeredPublishAt(base, 2, 3_600_000)).toBe(toLocalInput(new Date(new Date(base).getTime() + 7_200_000)));
    expect(staggeredPublishAt('', 3, 3_600_000)).toBe('');
  });

  it('finalText resuelve la plantilla con el video, la fecha programada y la firma', () => {
    const text = finalText({ title: null, description: '{titulo} ({fecha}) {firma_cuenta} #bloque:redes', publishAt: '2026-11-20T10:00' },
      { title: '{titulo}', description: '' },
      { video: { ...video, title: 'Grifo' }, signature: '— Ana', blocks: { redes: '#cocina' }, now: NOW });
    expect(text).toEqual({ title: 'Grifo', description: 'Grifo (20/11/2026) — Ana #cocina' });
  });

  it('los contadores usan las reglas del contexto', () => {
    expect(draftCounters('TIKTOK', newDraft(), ctx({ rules: { ...DEFAULT_RULES, tiktokTitleMax: 150 } }))).toBe('texto 5/150');
  });
});

describe('publish.models · publicaciones', () => {
  const linkedin = account('LINKEDIN');

  it('toPublicationRequest: medios en orden con su alt; enlace solo sin medios', () => {
    const media = [{ video: { ...video, id: 3 }, alt: ' Gráfico ' }, { video: { ...video, id: 2 }, alt: '' }];
    expect(toPublicationRequest(media, 'https://a.com', 'Título', true, [])).toEqual({ media: [{ id: 3, alt: 'Gráfico' }, { id: 2 }], title: 'Título', consent: true, destinations: [] });
    expect(toPublicationRequest([], ' https://a.com ', '', true, [])).toEqual({ media: [], linkUrl: 'https://a.com', consent: true, destinations: [] });
  });

  it('LinkedIn: visibilidad por defecto «Cualquiera» y primer comentario si la plataforma lo admite', () => {
    const rules = { ...DEFAULT_RULES, platforms: { ...DEFAULT_RULES.platforms, LINKEDIN: { ...DEFAULT_RULES.platforms.LINKEDIN, kinds: ['TEXT' as const], firstComment: true } } };
    const dest = toDestination(linkedin, { ...newDraft(), firstComment: ' #hola ' }, ctx({ media: [], kind: 'TEXT', rules }));
    expect(dest.privacyStatus).toBe('public');
    expect(dest.options).toEqual({ firstComment: '#hola' });
    const noComment = toDestination(linkedin, { ...newDraft(), firstComment: '#hola' }, ctx({ media: [], kind: 'TEXT' }));
    expect(noComment.options).toBeNull();
  });

  it('draftErrors de una página de empresa no admite «Solo mis contactos»', () => {
    const rules = { ...DEFAULT_RULES, platforms: { ...DEFAULT_RULES.platforms, LINKEDIN: { ...DEFAULT_RULES.platforms.LINKEDIN, kinds: ['TEXT' as const] } } };
    const page = account('LINKEDIN');
    page.accountHint = 'Página de empresa';
    expect(draftErrors(page, { ...newDraft(), privacy: 'connections' }, ctx({ media: [], kind: 'TEXT', rules }), undefined)).toContain('una página de empresa solo publica para «Cualquiera»');
  });

  it('contadores de LinkedIn y de Telegram sin medios', () => {
    expect(draftCounters('LINKEDIN', newDraft(), ctx())).toBe(`texto 10/${DEFAULT_RULES.linkedinTextMax}`);
    expect(draftCounters('TELEGRAM', newDraft(), ctx({ media: [], kind: 'TEXT' }))).toBe(`texto 10/${DEFAULT_RULES.telegramTextMax}`);
  });

  it('finalText sin medios deja {titulo} vacío', () => {
    expect(finalText({ title: null, description: '{titulo}!', publishAt: '' }, { title: '', description: '' }, { video: null, signature: null, blocks: {}, now: NOW }).description).toBe('!');
  });
});

describe('publish.models · Teams', () => {
  const rules = {
    ...DEFAULT_RULES,
    platforms: { ...DEFAULT_RULES.platforms, TEAMS: { ...DEFAULT_RULES.platforms.TEAMS, kinds: ['TEXT' as const], firstComment: true } },
    teamsWebhook: { ...DEFAULT_RULES.teamsWebhook, kinds: ['TEXT' as const] }
  };

  it('Graph envía @canal, primera respuesta y visibilidad pública', () => {
    const graph = { ...account('TEAMS'), externalId: 't1/c1' };
    const dest = toDestination(graph, { ...newDraft(), teamsMentionChannel: true, firstComment: 'gracias' }, ctx({ media: [], kind: 'TEXT', rules }));
    expect(dest.privacyStatus).toBe('public');
    expect(dest.options).toEqual({ firstComment: 'gracias', teamsMentionChannel: true });
  });

  it('el webhook no envía @canal ni primera respuesta', () => {
    const hook = { ...account('TEAMS'), externalId: 'webhook:x' };
    expect(toDestination(hook, { ...newDraft(), teamsMentionChannel: true, firstComment: 'x' }, ctx({ media: [], kind: 'TEXT', rules })).options).toBeNull();
  });
});
