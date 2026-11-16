import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ToastService } from '../services/toast.service';
import { conversationName, emailShareUrl, formatMinutes, formatSpan, inboxCapability, inviteMessage, quickReplyQuery, whatsAppShareUrl, windowState } from './inbox';
import { createCursorLoader } from './paged-loader';
import { INBOX_RULES, conversation } from '../../testing/page-mocks';

describe('utilidades de la bandeja', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');

  it('formatSpan y formatMinutes dan textos cortos', () => {
    expect(formatSpan(25 * 60_000)).toBe('25 min');
    expect(formatSpan(100 * 60_000)).toBe('1 h 40 min');
    expect(formatSpan(120 * 60_000)).toBe('2 h');
    expect(formatSpan(72 * 3600_000)).toBe('3 días');
    expect(formatMinutes(null)).toBe('—');
    expect(formatMinutes(38)).toBe('38 min');
  });

  it('la ventana de 24 h avisa en ámbar en las últimas 6 h y en rojo al cerrar', () => {
    expect(windowState({ windowExpiresAt: null }, now)).toBeNull();
    expect(windowState({ windowExpiresAt: '2026-11-16T22:00:00Z' }, now)).toEqual({ label: 'Ventana de 24 h: quedan 10 h', tone: 'neutral', closed: false });
    expect(windowState({ windowExpiresAt: '2026-11-16T13:40:00Z' }, now)?.tone).toBe('warning');
    const closed = windowState({ windowExpiresAt: '2026-11-16T09:00:00Z' }, now)!;
    expect(closed).toEqual({ label: 'Ventana cerrada hace 3 h', tone: 'danger', closed: true });
    // La empezamos nosotros (WhatsApp por número): cerrada hasta que el cliente escriba.
    expect(windowState({ windowExpiresAt: null, windowNeverOpened: true }, now)).toEqual({ label: 'El cliente aún no ha escrito', tone: 'warning', closed: true, neverOpened: true });
  });

  it('las invitaciones se comparten por WhatsApp o correo con el texto ya escrito', () => {
    const text = inviteMessage('Ana', 'Telegram', 'https://t.me/bot?start=inv1');
    expect(text).toBe('Hola Ana, puedes escribirnos por Telegram desde este enlace: https://t.me/bot?start=inv1');
    expect(whatsAppShareUrl('+51 987 654 321', 'hola y adiós')).toBe('https://wa.me/51987654321?text=hola%20y%20adi%C3%B3s');
    expect(whatsAppShareUrl(null, 'x')).toBe('https://wa.me/?text=x');
    expect(emailShareUrl('ana@x.com', 'Asunto', 'Cuerpo')).toBe('mailto:ana%40x.com?subject=Asunto&body=Cuerpo');
  });

  it('el nombre es la persona en privados y la publicación o el grupo en el resto', () => {
    expect(conversationName(conversation())).toBe('Lucía Pérez');
    expect(conversationName(conversation({ contactName: null }))).toBe('+51999');
    expect(conversationName(conversation({ kind: 'COMMENTS', title: 'Tutorial 12' }))).toBe('Tutorial 12');
  });

  it('las capacidades salen de las reglas del servidor por plataforma y tipo', () => {
    expect(inboxCapability(INBOX_RULES, 'YOUTUBE', 'COMMENTS')?.quotaUnits).toBe(50);
    expect(inboxCapability(INBOX_RULES, 'TIKTOK', 'DIRECT')).toBeNull();
    expect(inboxCapability(null, 'WHATSAPP', 'DIRECT')).toBeNull();
  });

  it('«/atajo» sugiere las respuestas propias; un texto normal no', () => {
    expect(quickReplyQuery('/')).toBe('');
    expect(quickReplyQuery('/Env')).toBe('env');
    expect(quickReplyQuery('Hola /env')).toBeNull();
    expect(quickReplyQuery('/envio hola')).toBeNull();
  });
});

describe('createCursorLoader', () => {
  it('pide cada página desde el último elemento y para cuando una página no viene llena', () => {
    TestBed.configureTestingModule({ providers: [{ provide: ToastService, useValue: { error: jest.fn() } }] });
    const fetch = jest.fn((last: number | null, take: number) =>
      of(last === null ? [10, 9] : last === 9 ? [8] : []).pipe(source => (take === 2 ? source : source)));
    const loader = TestBed.runInInjectionContext(() => createCursorLoader<number>(fetch, { take: 2 }));

    loader.reload();
    expect(loader.value()).toEqual([10, 9]);
    expect(loader.hasMore()).toBe(true);
    loader.loadMore();
    expect(fetch).toHaveBeenLastCalledWith(9, 2);
    expect(loader.value()).toEqual([10, 9, 8]);
    expect(loader.hasMore()).toBe(false);
  });
});
