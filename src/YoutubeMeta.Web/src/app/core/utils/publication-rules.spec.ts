import {
  DEFAULT_RULES,
  IDestinationCheck,
  publicationRules,
  setPublicationRules,
  destinationErrors,
  hashtagCount,
  hasAngleBrackets,
  mentionCount,
  splitTags,
  telegramCaption,
  youtubeTagsLength
} from './publication-rules';
import { addMonths } from './dates';

const INSTAGRAM_CAPTION_MAX = DEFAULT_RULES.instagramCaptionMax;
const NOW = new Date('2026-11-15T10:00:00Z').getTime();

function check(overrides: Partial<IDestinationCheck>): IDestinationCheck {
  return {
    platform: 'YOUTUBE',
    title: 'Mi video',
    description: '',
    tags: '',
    categoryId: '26',
    privacy: 'public',
    publishAt: null,
    madeForKids: false,
    synthetic: false,
    tiktokInbox: false,
    brandContent: false,
    sizeBytes: 10 * 1024 * 1024,
    durationSec: 60,
    uploadLimitMb: null,
    tiktokPrivacyOptions: ['SELF_ONLY'],
    tiktokMaxDurationSec: 600,
    ...overrides
  };
}

describe('publication-rules', () => {
  describe('splitTags', () => {
    it('quita vacíos, espacios y duplicados sin distinguir mayúsculas', () => {
      expect(splitTags(' baño, Grifería ,,baño, BAÑO ,ducha')).toEqual(['baño', 'Grifería', 'ducha']);
    });

    it('acepta null', () => {
      expect(splitTags(null)).toEqual([]);
    });
  });

  describe('youtubeTagsLength', () => {
    it('cuenta las comas y +2 por etiqueta con espacios (comillas)', () => {
      // "a" (1) + "b c" (3+2) + 1 coma = 7
      expect(youtubeTagsLength('a, b c')).toBe(7);
    });

    it('vacío = 0', () => {
      expect(youtubeTagsLength('')).toBe(0);
    });
  });

  it('hasAngleBrackets detecta < y >', () => {
    expect(hasAngleBrackets('hola <b>')).toBe(true);
    expect(hasAngleBrackets('hola')).toBe(false);
    expect(hasAngleBrackets(null)).toBe(false);
  });

  it('hashtagCount y mentionCount solo cuentan los que empiezan palabra', () => {
    expect(hashtagCount('#uno texto#no #dos #tres_3')).toBe(3);
    expect(mentionCount('@ana correo@x.com @luis.p')).toBe(2);
  });

  it('telegramCaption usa la descripción o, si está vacía, el título', () => {
    expect(telegramCaption('Título', 'Desc')).toBe('Desc');
    expect(telegramCaption('Título', '   ')).toBe('Título');
  });

  it('addMonths suma meses calendario', () => {
    expect(addMonths(new Date(2026, 0, 15), 6).getMonth()).toBe(6);
  });

  describe('destinationErrors', () => {
    it('YouTube válido no tiene errores', () => {
      expect(destinationErrors(check({}), NOW)).toEqual([]);
    });

    it('YouTube exige título, categoría, visibilidad y respuesta sobre IA', () => {
      const errors = destinationErrors(check({ title: ' ', categoryId: '', privacy: null, synthetic: null }), NOW);
      expect(errors).toEqual(expect.arrayContaining(['falta el título', 'elige la categoría', 'elige la visibilidad', 'indica si contiene IA']));
    });

    it('YouTube limita el título a 100 y rechaza < >', () => {
      const errors = destinationErrors(check({ title: 'x'.repeat(101), description: 'a > b' }), NOW);
      expect(errors).toContain('título de más de 100');
      expect(errors).toContain('no se permiten < ni >');
    });

    it('la fecha programada debe ser futura', () => {
      expect(destinationErrors(check({ publishAt: new Date(NOW - 1000) }), NOW)).toContain('la fecha debe ser futura');
    });

    it('Facebook exige 10 minutos de antelación y máximo 6 meses', () => {
      expect(destinationErrors(check({ platform: 'FACEBOOK', publishAt: new Date(NOW + 5 * 60_000) }), NOW)).toContain('mínimo 10 minutos desde ahora');
      expect(destinationErrors(check({ platform: 'FACEBOOK', publishAt: new Date(NOW + 11 * 60_000) }), NOW)).toEqual([]);
      expect(destinationErrors(check({ platform: 'FACEBOOK', publishAt: addMonths(new Date(NOW), 7) }), NOW)).toContain('máximo 6 meses');
    });

    it('Instagram limita texto, tamaño y duración', () => {
      const errors = destinationErrors(check({
        platform: 'INSTAGRAM',
        description: 'x'.repeat(INSTAGRAM_CAPTION_MAX + 1),
        sizeBytes: 301 * 1024 * 1024,
        durationSec: 2
      }), NOW);
      expect(errors).toEqual(expect.arrayContaining([`texto de más de ${INSTAGRAM_CAPTION_MAX}`, 'más de 300 MB', 'debe durar de 3 s a 15 min']));
    });

    it('Telegram respeta el límite del bot (50 MB por defecto)', () => {
      expect(destinationErrors(check({ platform: 'TELEGRAM', sizeBytes: 60 * 1024 * 1024 }), NOW)).toContain('el bot admite hasta 50 MB');
      expect(destinationErrors(check({ platform: 'TELEGRAM', sizeBytes: 60 * 1024 * 1024, uploadLimitMb: 2000 }), NOW)).toEqual([]);
    });

    it('TikTok directo exige privacidad y no admite contenido de marca privado', () => {
      expect(destinationErrors(check({ platform: 'TIKTOK', privacy: null }), NOW)).toContain('elige quién puede verlo');
      expect(destinationErrors(check({ platform: 'TIKTOK', privacy: 'private', brandContent: true }), NOW)).toContain('el contenido de marca no puede ser privado');
    });

    it('TikTok espera creator_info y respeta la duración máxima de la cuenta', () => {
      expect(destinationErrors(check({ platform: 'TIKTOK', tiktokPrivacyOptions: null }), NOW)).toContain('cargando los datos de la cuenta');
      expect(destinationErrors(check({ platform: 'TIKTOK', durationSec: 700, tiktokMaxDurationSec: 600 }), NOW)).toContain('la cuenta admite hasta 10 min');
    });

    it('TikTok como borrador no pide privacidad', () => {
      expect(destinationErrors(check({ platform: 'TIKTOK', tiktokInbox: true, privacy: null, tiktokPrivacyOptions: null }), NOW)).toEqual([]);
    });
  });

  describe('reglas del servidor', () => {
    afterEach(() => setPublicationRules(null));

    it('sustituyen a las de por defecto y lo que falte conserva el valor por defecto', () => {
      setPublicationRules({ youtubeTitleMax: 50 });
      expect(publicationRules().youtubeTitleMax).toBe(50);
      expect(publicationRules().titleMax).toBe(DEFAULT_RULES.titleMax);
      expect(destinationErrors(check({ title: 'x'.repeat(60) }), NOW)).toContain('título de más de 50');
    });

    it('los textos de error usan los valores recibidos', () => {
      setPublicationRules({ facebookScheduleMinMinutes: 30, scheduleMaxMonths: 2 });
      expect(destinationErrors(check({ platform: 'FACEBOOK', publishAt: new Date(NOW + 20 * 60_000) }), NOW)).toContain('mínimo 30 minutos desde ahora');
      expect(destinationErrors(check({ platform: 'FACEBOOK', publishAt: addMonths(new Date(NOW), 3) }), NOW)).toContain('máximo 2 meses');
    });

    it('se pueden pasar explícitamente', () => {
      const errors = destinationErrors(check({ platform: 'TELEGRAM', description: 'x'.repeat(20) }), NOW, { ...DEFAULT_RULES, telegramCaptionMax: 10 });
      expect(errors).toContain('texto de más de 10');
    });
  });
});
