import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PLATFORM_META } from '../constants/status.constants';
import { InboxHttp, VideoHttp } from '../http/api.http';
import { IInboxUpdate, IPublishUpdate } from '../models/api.models';
import { NOTIFY_STATUSES, publishNotificationText } from '../utils/notification-text';
import { readStored, writeStored } from '../utils/storage';
import { ToastService } from './toast.service';

const STORAGE_KEY = 'ym.notifications';

/**
 * Notificaciones del navegador (opcionales): con la pestaña en segundo plano, avisa cuando una publicación termina
 * (publicada, fallida o por revisar) y cuando llega un mensaje a la bandeja. Al pulsarla se abre el video o la conversación.
 */
@Injectable({ providedIn: 'root' })
export class BrowserNotificationService {
  private readonly router = inject(Router);
  private readonly videos = inject(VideoHttp);
  private readonly inbox = inject(InboxHttp);
  private readonly toast = inject(ToastService);
  private readonly zone = inject(NgZone);

  readonly supported = typeof window !== 'undefined' && 'Notification' in window;
  readonly enabled = signal(this.supported && readStored<boolean>(STORAGE_KEY, false) && Notification.permission === 'granted');

  async toggle(): Promise<void> {
    if (!this.supported) return;
    if (this.enabled()) return this.save(false);
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission === 'granted') this.save(true);
    else this.toast.warning('El navegador no permite notificaciones de este sitio. Actívalas en los permisos del sitio.');
  }

  /** Aviso de una publicación terminada, solo si la pestaña no está a la vista. */
  async notify(update: IPublishUpdate): Promise<void> {
    if (!this.enabled() || document.visibilityState === 'visible' || !update.isFinal || !NOTIFY_STATUSES.includes(update.status)) return;
    const videoId = update.videoId;
    const title = videoId != null ? await firstValueFrom(this.videos.get(videoId)).then(v => v.title).catch(() => null) : null;
    const text = publishNotificationText(update.status, PLATFORM_META[update.target].label, title);
    if (!text) return;
    const notification = new Notification(text.title, { body: text.body, tag: `ym-pub-${update.publicationId}`, icon: 'favicon.svg' });
    notification.onclick = () => this.zone.run(() => {
      window.focus();
      void this.router.navigate(videoId != null ? ['/videos', videoId] : ['/publications']);
      notification.close();
    });
  }

  /** Mensaje nuevo en la bandeja, solo si la pestaña no está a la vista. */
  async notifyInbox(update: IInboxUpdate): Promise<void> {
    if (!this.enabled() || document.visibilityState === 'visible' || !update.isNew) return;
    const conversation = await firstValueFrom(this.inbox.conversation(update.conversationId)).catch(() => null);
    if (!conversation) return;
    const who = conversation.kind === 'DIRECT' ? conversation.contactName ?? conversation.title : conversation.title;
    const notification = new Notification(`${PLATFORM_META[conversation.platform].label} · ${who}`, {
      body: conversation.lastMessagePreview ?? 'Mensaje nuevo',
      tag: `ym-inbox-${conversation.id}`,
      icon: 'favicon.svg'
    });
    notification.onclick = () => this.zone.run(() => {
      window.focus();
      void this.router.navigate(['/inbox', conversation.id]);
      notification.close();
    });
  }

  private save(enabled: boolean): void {
    this.enabled.set(enabled);
    writeStored(STORAGE_KEY, enabled);
  }
}
