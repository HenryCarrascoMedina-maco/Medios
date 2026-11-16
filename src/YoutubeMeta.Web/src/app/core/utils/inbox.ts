import type { ChipTone } from '@shared/ui/chip.component';
import { IInboxCapability, IInboxConversation, IInboxRules, InboxKind, Platform } from '../models/api.models';

/** Menos de esto para que cierre la ventana de 24 h: se avisa en ámbar. */
export const WINDOW_WARN_MS = 6 * 60 * 60_000;

/** «1 h 40 min», «25 min», «3 días». */
export function formatSpan(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return `${Math.round(hours / 24)} días`;
}

/** Tiempo de respuesta para las cifras: «38 min», «2 h 5 min» o «—». */
export function formatMinutes(minutes: number | null | undefined): string {
  return minutes == null ? '—' : formatSpan(minutes * 60_000);
}

export interface IWindowState {
  /** Texto corto: «Ventana: quedan 1 h 40 min» / «Ventana cerrada hace 3 h». */
  label: string;
  tone: ChipTone;
  closed: boolean;
  /** Cerrada porque el cliente aún no escribió (no porque pasaran 24 h). */
  neverOpened?: boolean;
}

/**
 * Ventana de 24 h de Messenger, Instagram y WhatsApp (la calcula el servidor en windowExpiresAt). Null si la
 * conversación no tiene ventana (comentarios, Telegram, YouTube, Teams). Si la empezamos nosotros y el cliente aún no
 * escribió (windowNeverOpened), está cerrada: solo plantilla.
 */
export function windowState(conversation: Pick<IInboxConversation, 'windowExpiresAt' | 'windowNeverOpened'>, now = Date.now()): IWindowState | null {
  if (conversation.windowNeverOpened) return { label: 'El cliente aún no ha escrito', tone: 'warning', closed: true, neverOpened: true };
  if (!conversation.windowExpiresAt) return null;
  const left = Date.parse(conversation.windowExpiresAt) - now;
  if (left <= 0) return { label: `Ventana cerrada hace ${formatSpan(left)}`, tone: 'danger', closed: true };
  return { label: `Ventana de 24 h: quedan ${formatSpan(left)}`, tone: left < WINDOW_WARN_MS ? 'warning' : 'neutral', closed: false };
}

/** Nombre que se muestra: la persona en privados; la publicación o el grupo en el resto. */
export function conversationName(conversation: Pick<IInboxConversation, 'kind' | 'contactName' | 'contactHandle' | 'title'>): string {
  return conversation.kind === 'DIRECT' ? conversation.contactName ?? conversation.contactHandle ?? conversation.title : conversation.title;
}

/** Redes con chat privado en la bandeja: WhatsApp se escribe primero por número; las demás, por enlace de invitación. */
export const DIRECT_PLATFORMS: readonly Platform[] = ['WHATSAPP', 'TELEGRAM', 'FACEBOOK', 'INSTAGRAM'];

/** Texto con el que se manda una invitación (por WhatsApp o por correo). */
export function inviteMessage(name: string, network: string, link: string): string {
  return `Hola ${name}, puedes escribirnos por ${network} desde este enlace: ${link}`;
}

/** wa.me con el texto ya escrito; sin teléfono, WhatsApp deja elegir a quién mandarlo. */
export function whatsAppShareUrl(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function emailShareUrl(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Lo que admite una plataforma al responder en ese tipo de conversación (sin reglas: nada). */
export function inboxCapability(rules: IInboxRules | null, platform: Platform, kind: InboxKind): IInboxCapability | null {
  return rules?.capabilities[`${platform}:${kind}`] ?? null;
}

/** «/envio hola» → atajo «envio» si el texto empieza por barra (para sugerir las respuestas de Ajustes › Plantillas). */
export function quickReplyQuery(text: string): string | null {
  const match = /^\/([\p{L}\p{N}_-]*)$/u.exec(text.trim());
  return match ? match[1].toLowerCase() : null;
}
