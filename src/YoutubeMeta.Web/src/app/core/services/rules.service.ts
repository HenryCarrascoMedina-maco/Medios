import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CONNECT_PLATFORMS, PLATFORMS } from '../constants/status.constants';
import { PublicationHttp } from '../http/api.http';
import { IPublicationRules, Platform } from '../models/api.models';
import { publicationRules, setPublicationRules } from '../utils/publication-rules';

/**
 * Reglas de publicación del servidor (GET /api/Publication/Rules), pedidas una sola vez. Hasta que
 * llegan (o si fallan) valen los valores por defecto. `rules` es un signal: los computed que validan
 * se recalculan al llegar.
 */
@Injectable({ providedIn: 'root' })
export class RulesService {
  private readonly http = inject(PublicationHttp);
  private loading: Promise<void> | null = null;
  private readonly current = signal<IPublicationRules>(publicationRules());

  readonly rules = this.current.asReadonly();

  private readonly enabled = computed(() => new Set(this.current().enabledPlatforms));
  /** Plataformas que publican y están activas en esta instalación (en el orden de PLATFORMS). */
  readonly publishPlatforms = computed(() => PLATFORMS.filter(p => this.enabled().has(p)));
  /** Plataformas que se pueden conectar (incluye WhatsApp, que solo es de la bandeja). */
  readonly connectPlatforms = computed(() => CONNECT_PLATFORMS.filter(p => this.enabled().has(p)));
  /** Las de la bandeja: la API de TikTok no deja leer mensajes ni comentarios. */
  readonly inboxPlatforms = computed(() => this.connectPlatforms().filter(p => p !== 'TIKTOK'));

  constructor() {
    // Quien la use primero la pide: ninguna pantalla depende de que el shell ya la haya cargado.
    void this.ensure();
  }

  isEnabled(platform: Platform): boolean {
    return this.enabled().has(platform);
  }

  ensure(): Promise<void> {
    this.loading ??= firstValueFrom(this.http.rules())
      .then(rules => {
        setPublicationRules(rules);
        this.current.set(publicationRules());
      })
      .catch(() => {
        this.loading = null;
      });
    return this.loading;
  }
}
