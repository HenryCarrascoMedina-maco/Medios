import { Injectable, NgZone, OnDestroy, inject, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { Observable, Subject, filter, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { IInboxUpdate, IPublishUpdate } from '../models/api.models';
import { SessionService } from '../session/session.service';

export interface IEntityUpdate {
  entity: string;
  data: unknown;
}

/**
 * Entidades que emite el ProgressHub y su payload. Las que solo avisan de «algo cambió» llevan
 * `unknown`: la pantalla recarga y no lee el contenido.
 */
export interface IEntityPayloads {
  VideoPublish: IPublishUpdate;
  VideoUpload: unknown;
  Connection: unknown;
  Credential: unknown;
  Inbox: IInboxUpdate;
}

const RESTART_MIN_DELAY_MS = 5000;
const RESTART_MAX_DELAY_MS = 60000;

/**
 * Conexión al ProgressHub (mismo patrón que el EntityHubService de Sinsatools): token releído en
 * cada intento, reconexión automática para cortes cortos y rearme con backoff si la conexión muere.
 * Tras reconectar emite reconnected$ para que cada pantalla recargue lo que pudo perderse.
 */
@Injectable({ providedIn: 'root' })
export class EntityHubService implements OnDestroy {
  private readonly session = inject(SessionService);
  private readonly zone = inject(NgZone);

  private connection: HubConnection | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartDelay = RESTART_MIN_DELAY_MS;
  private manuallyStopped = false;
  private hasConnectedBefore = false;

  private readonly updates = new Subject<IEntityUpdate>();
  private readonly reconnectedSubject = new Subject<void>();

  readonly entityUpdate$ = this.updates.asObservable();
  readonly reconnected$ = this.reconnectedSubject.asObservable();
  readonly connected = signal(false);

  on<K extends keyof IEntityPayloads>(entity: K): Observable<IEntityPayloads[K]> {
    return this.entityUpdate$.pipe(
      filter(update => update.entity === entity && update.data != null),
      map(update => update.data as IEntityPayloads[K])
    );
  }

  publishUpdates(): Observable<IPublishUpdate> {
    return this.on('VideoPublish');
  }

  start(): void {
    if (this.connection?.state === HubConnectionState.Connected) return;
    void this.connection?.stop().catch(() => undefined);

    this.manuallyStopped = false;
    this.clearRestartTimer();

    const connection = new HubConnectionBuilder()
      .withUrl(environment.hubUrl, { accessTokenFactory: () => this.session.getToken() ?? '' })
      .configureLogging(LogLevel.Warning)
      .withAutomaticReconnect()
      .build();
    this.connection = connection;

    connection.on('ReceiveEntityUpdate', (entity: string, data: unknown) => {
      const parsed = typeof data === 'string' && data !== '' ? safeParse(data) : (data ?? null);
      this.zone.run(() => this.updates.next({ entity, data: parsed }));
    });
    connection.onreconnecting(() => this.zone.run(() => this.connected.set(false)));
    connection.onreconnected(() => this.zone.run(() => {
      this.connected.set(true);
      this.reconnectedSubject.next();
    }));
    connection.onclose(() => {
      this.zone.run(() => this.connected.set(false));
      if (this.connection === connection) this.scheduleRestart();
    });

    connection
      .start()
      .then(() => this.zone.run(() => {
        this.connected.set(true);
        this.restartDelay = RESTART_MIN_DELAY_MS;
        if (this.hasConnectedBefore) this.reconnectedSubject.next();
        this.hasConnectedBefore = true;
      }))
      .catch(() => {
        if (this.connection === connection) this.scheduleRestart();
      });
  }

  stop(): void {
    this.manuallyStopped = true;
    this.clearRestartTimer();
    void this.connection?.stop().catch(() => undefined);
    this.connection = null;
    this.connected.set(false);
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private scheduleRestart(): void {
    if (this.manuallyStopped || this.restartTimer != null || !this.session.isAuthenticated()) return;

    const delay = this.restartDelay;
    this.restartDelay = Math.min(this.restartDelay * 2, RESTART_MAX_DELAY_MS);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.manuallyStopped) this.start();
    }, delay);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer == null) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
