import { IPublicationRules } from '../models/api.models';
import { SERVER_RULES, image, pdf, video } from '../../testing/page-mocks';
import {
  DEFAULT_RULES, IDestinationCheck, PUBLIC_URL_REASON, TEAMS_WEBHOOK_REASON, capabilityOf, destinationErrors, postBlockers, publicationRules, setPublicationRules, textLimits
} from './publication-rules';

const NOW = new Date('2026-11-15T10:00:00Z').getTime();
const MB = 1024 * 1024;
const r: IPublicationRules = SERVER_RULES;

function check(overrides: Partial<IDestinationCheck>): IDestinationCheck {
  return {
    platform: 'LINKEDIN', title: '', description: 'Hola', tags: '', categoryId: '', privacy: 'public', publishAt: null, madeForKids: false, synthetic: false,
    tiktokInbox: false, brandContent: false, sizeBytes: 0, durationSec: null, uploadLimitMb: null, tiktokPrivacyOptions: ['SELF_ONLY'], tiktokMaxDurationSec: 600,
    kind: 'TEXT', media: [], firstComment: '', linkedinPage: false, ...overrides
  };
}

describe('postBlockers (disponibilidad por cuenta)', () => {
  it('tipo no admitido: «X no admite publicaciones de tipo …»', () => {
    expect(postBlockers('INSTAGRAM', { kind: 'TEXT', media: [] }, r)).toEqual(['Instagram no admite publicaciones de tipo texto']);
    expect(postBlockers('TIKTOK', { kind: 'DOCUMENT', media: [pdf(1)] }, r)).toEqual(['TikTok no admite publicaciones de tipo pdf']);
  });

  it('YouTube solo admite videos aunque el servidor dijera otra cosa', () => {
    const permissive = { ...r, platforms: { ...r.platforms, YOUTUBE: { ...r.platforms.YOUTUBE, kinds: ['VIDEO', 'IMAGE'] } } } as IPublicationRules;
    expect(postBlockers('YOUTUBE', { kind: 'IMAGE', media: [image(1)] }, permissive)[0]).toContain('YouTube no admite');
    expect(postBlockers('YOUTUBE', { kind: 'VIDEO', media: [video()] }, r)).toEqual([]);
  });

  it('demasiadas imágenes para la plataforma', () => {
    const eleven = Array.from({ length: 11 }, (_, n) => image(n + 1));
    expect(postBlockers('FACEBOOK', { kind: 'CAROUSEL', media: eleven }, r)).toContain('Facebook admite hasta 10 imágenes');
    expect(postBlockers('LINKEDIN', { kind: 'CAROUSEL', media: eleven }, r)).toEqual([]);
  });

  it('un álbum de Telegram necesita al menos 2 imágenes', () => {
    expect(postBlockers('TELEGRAM', { kind: 'CAROUSEL', media: [image(1)] }, r)).toContain('un álbum de Telegram necesita al menos 2 imágenes');
    expect(postBlockers('TELEGRAM', { kind: 'CAROUSEL', media: [image(1), image(2)] }, r)).toEqual([]);
  });

  it('formato de imagen no admitido', () => {
    const rules = { ...r, publicMediaAvailable: true };
    expect(postBlockers('INSTAGRAM', { kind: 'IMAGE', media: [image(1, { contentType: 'image/png' })] }, rules)).toEqual(['Instagram no admite imágenes PNG']);
  });

  it('imagen demasiado grande', () => {
    expect(postBlockers('LINKEDIN', { kind: 'IMAGE', media: [image(1, { sizeBytes: 9 * MB, title: 'Grande' })] }, r)).toEqual(['imagen «Grande» de más de 8 MB']);
  });

  it('Instagram y TikTok necesitan dominio público para las imágenes', () => {
    expect(postBlockers('INSTAGRAM', { kind: 'IMAGE', media: [image(1)] }, r)).toEqual([PUBLIC_URL_REASON]);
    expect(postBlockers('INSTAGRAM', { kind: 'IMAGE', media: [image(1)] }, { ...r, publicMediaAvailable: true })).toEqual([]);
    expect(postBlockers('INSTAGRAM', { kind: 'VIDEO', media: [video()] }, r)).toEqual([]);
  });

  it('PDF demasiado grande', () => {
    expect(postBlockers('TELEGRAM', { kind: 'DOCUMENT', media: [pdf(1, { sizeBytes: 60 * MB })] }, r)).toEqual(['PDF de más de 50 MB']);
  });
});

describe('destinationErrors con publicaciones', () => {
  it('si el tipo no cabe, solo se dice eso', () => {
    expect(destinationErrors(check({ platform: 'INSTAGRAM', description: '' }), NOW, r)).toEqual(['Instagram no admite publicaciones de tipo texto']);
  });

  it('texto obligatorio en texto y enlace; Telegram usa el título si no hay texto', () => {
    expect(destinationErrors(check({ description: ' ' }), NOW, r)).toContain('falta el texto');
    expect(destinationErrors(check({ kind: 'LINK', description: '' }), NOW, r)).toContain('falta el texto');
    expect(destinationErrors(check({ platform: 'TELEGRAM', description: '', title: 'Aviso' }), NOW, r)).toEqual([]);
    expect(destinationErrors(check({ platform: 'TELEGRAM', description: '', title: '' }), NOW, r)).toContain('falta el texto');
  });

  it('límite de texto sin medios (textMax) y de pie con medios en Telegram', () => {
    expect(destinationErrors(check({ platform: 'TELEGRAM', description: 'x'.repeat(4097) }), NOW, r)).toContain('texto de más de 4096');
    expect(destinationErrors(check({ platform: 'TELEGRAM', description: 'x'.repeat(2000) }), NOW, r)).toEqual([]);
    const media = [image(1), image(2)];
    expect(destinationErrors(check({ platform: 'TELEGRAM', kind: 'CAROUSEL', media, description: 'x'.repeat(2000) }), NOW, r)).toContain(`texto de más de ${r.telegramCaptionMax}`);
    const noCap = { ...r, platforms: { ...r.platforms, TELEGRAM: { ...r.platforms.TELEGRAM, textMax: null } } };
    expect(destinationErrors(check({ platform: 'TELEGRAM', description: 'x'.repeat(4097) }), NOW, noCap)).toContain(`texto de más de ${r.telegramTextMax}`);
  });

  it('LinkedIn: texto, título, video y visibilidad de páginas', () => {
    expect(destinationErrors(check({ description: 'x'.repeat(3001) }), NOW, r)).toContain('texto de más de 3000');
    expect(destinationErrors(check({ kind: 'DOCUMENT', media: [pdf(1)], title: 'x'.repeat(201) }), NOW, r)).toContain(`título de más de ${r.linkedinTitleMax}`);
    expect(destinationErrors(check({ kind: 'VIDEO', media: [video()], title: 'Demo', sizeBytes: r.linkedinVideoMaxBytes + 1 }), NOW, r)).toContain('más de 5 GB');
    expect(destinationErrors(check({ privacy: 'connections', linkedinPage: true }), NOW, r)).toContain('una página de empresa solo publica para «Cualquiera»');
    expect(destinationErrors(check({ privacy: 'connections' }), NOW, r)).toEqual([]);
  });

  it('título obligatorio en video y PDF, opcional en imágenes y texto', () => {
    expect(destinationErrors(check({ kind: 'DOCUMENT', media: [pdf(1)] }), NOW, r)).toContain('falta el título');
    expect(destinationErrors(check({ kind: 'IMAGE', media: [image(1)] }), NOW, r)).toEqual([]);
  });

  it('primer comentario: longitud y solo donde la plataforma lo admite', () => {
    expect(destinationErrors(check({ firstComment: 'x'.repeat(r.firstCommentMax + 1) }), NOW, r)).toContain(`primer comentario de más de ${r.firstCommentMax}`);
    expect(destinationErrors(check({ platform: 'TELEGRAM', firstComment: '#hola' }), NOW, r)).toContain('Telegram no admite primer comentario');
    expect(destinationErrors(check({ firstComment: '#hola' }), NOW, r)).toEqual([]);
  });

  it('las reglas de duración de Instagram solo se aplican a videos', () => {
    const rules = { ...r, publicMediaAvailable: true };
    expect(destinationErrors(check({ platform: 'INSTAGRAM', kind: 'IMAGE', media: [image(1)], durationSec: 1 }), NOW, rules)).toEqual([]);
  });

  it('el bot de Telegram limita el tamaño de cada archivo', () => {
    const big = pdf(1, { sizeBytes: 49 * MB });
    expect(destinationErrors(check({ platform: 'TELEGRAM', kind: 'DOCUMENT', media: [big], title: 'Caso', uploadLimitMb: 20 }), NOW, r)).toContain('el bot admite hasta 20 MB');
  });
});

describe('reglas del servidor', () => {
  afterEach(() => setPublicationRules(null));

  it('sin /Rules todas las plataformas admiten solo videos', () => {
    expect(capabilityOf('LINKEDIN', DEFAULT_RULES).kinds).toEqual(['VIDEO']);
    expect(postBlockers('LINKEDIN', { kind: 'TEXT', media: [] }, DEFAULT_RULES)).toHaveLength(1);
  });

  it('las capacidades parciales del servidor se completan con las de por defecto', () => {
    setPublicationRules({ linkedinTextMax: 2000, platforms: { LINKEDIN: { kinds: ['TEXT'] } } as unknown as IPublicationRules['platforms'] });
    expect(publicationRules().linkedinTextMax).toBe(2000);
    expect(capabilityOf('LINKEDIN')).toMatchObject({ platform: 'LINKEDIN', kinds: ['TEXT'], firstComment: false });
    expect(capabilityOf('YOUTUBE').kinds).toEqual(['VIDEO']);
  });

  it('textLimits de Telegram cambia sin medios', () => {
    expect(textLimits('TELEGRAM', r).description).toBe(r.telegramCaptionMax);
    expect(textLimits('TELEGRAM', r, true).description).toBe(4096);
    expect(textLimits('LINKEDIN', r)).toEqual({ title: r.linkedinTitleMax, description: r.linkedinTextMax });
  });
});

describe('Teams: Graph frente a webhook', () => {
  it('el webhook solo admite texto, enlace e imágenes por dirección pública', () => {
    expect(postBlockers('TEAMS', { kind: 'VIDEO', media: [video()] }, r, true)).toEqual([TEAMS_WEBHOOK_REASON]);
    expect(postBlockers('TEAMS', { kind: 'DOCUMENT', media: [pdf(1)] }, r, true)).toEqual([TEAMS_WEBHOOK_REASON]);
    expect(postBlockers('TEAMS', { kind: 'IMAGE', media: [image(1)] }, r, true)).toEqual([PUBLIC_URL_REASON]);
    expect(postBlockers('TEAMS', { kind: 'TEXT', media: [] }, r, true)).toEqual([]);
  });

  it('Graph admite video, PDF e imágenes sin dominio público', () => {
    expect(postBlockers('TEAMS', { kind: 'VIDEO', media: [video()] }, r)).toEqual([]);
    expect(postBlockers('TEAMS', { kind: 'IMAGE', media: [image(1)] }, r)).toEqual([]);
    expect(postBlockers('TEAMS', { kind: 'DOCUMENT', media: [pdf(1, { sizeBytes: 300 * MB })] }, r)).toEqual(['PDF de más de 250 MB']);
  });

  it('primera respuesta solo con Graph y límite de texto también con medios', () => {
    expect(destinationErrors(check({ platform: 'TEAMS', teamsWebhook: true, firstComment: 'hola' }), NOW, r)).toContain('un canal por webhook no admite primera respuesta');
    expect(destinationErrors(check({ platform: 'TEAMS', firstComment: 'hola' }), NOW, r)).toEqual([]);
    expect(destinationErrors(check({ platform: 'TEAMS', kind: 'IMAGE', media: [image(1)], description: 'x'.repeat(20001) }), NOW, r)).toContain('texto de más de 20000');
  });

  it('sin /Rules la capacidad del webhook es solo video (por defecto)', () => {
    expect(capabilityOf('TEAMS', DEFAULT_RULES, true).kinds).toEqual(['VIDEO']);
    setPublicationRules({ teamsWebhook: { kinds: ['TEXT'] } as unknown as IPublicationRules['teamsWebhook'] });
    expect(capabilityOf('TEAMS', publicationRules(), true)).toMatchObject({ platform: 'TEAMS', kinds: ['TEXT'] });
    setPublicationRules(null);
  });
});
