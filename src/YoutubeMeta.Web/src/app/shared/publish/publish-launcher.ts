import { inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ConnectionHttp } from '@core/http/api.http';
import { IConnection, ITemplate, IVideo } from '@core/models/api.models';
import { ToastService } from '@core/services/toast.service';
import { apiError } from '@core/utils/format';
import { IPublishSchedule } from './publish.dialog';

export interface IPublishRequest {
  videos: IVideo[];
  accounts: IConnection[];
  schedule: IPublishSchedule | null;
  asPost: boolean;
  template: ITemplate | null;
}

/**
 * Abre el diálogo de publicación desde una pantalla que no tiene las cuentas cargadas (Medios,
 * Calendario, Publicaciones): las pide, y si no hay ninguna manda a Conexiones. Llamar en contexto de inyección.
 *   readonly publish = createPublishLauncher();
 *   @if (publish.request(); as r) { <ym-publish-dialog [videos]="r.videos" [asPost]="r.asPost" … (closed)="publish.close()" /> }
 */
export function createPublishLauncher() {
  const connections = inject(ConnectionHttp);
  const toast = inject(ToastService);
  const router = inject(Router);
  const request = signal<IPublishRequest | null>(null);
  const opening = signal(false);

  return {
    request: request.asReadonly(),
    opening: opening.asReadonly(),
    /** Sin `asPost`, varios medios = una publicación por cada uno (en serie); con `asPost`, UNA publicación (sin medios: texto o enlace). */
    async open(videos: IVideo[], schedule: IPublishSchedule | null = null, options: { asPost?: boolean; template?: ITemplate } = {}): Promise<void> {
      const asPost = options.asPost ?? false;
      if ((!videos.length && !asPost) || opening()) return;
      opening.set(true);
      try {
        const { accounts } = await firstValueFrom(connections.status());
        if (accounts.length === 0) {
          toast.warning('Primero conecta al menos una cuenta en Conexiones.');
          void router.navigate(['/connections']);
          return;
        }
        request.set({ videos, accounts, schedule, asPost, template: options.template ?? null });
      } catch (error) {
        toast.error(apiError(error, 'No se pudieron cargar las cuentas.'));
      } finally {
        opening.set(false);
      }
    },
    close(): void {
      request.set(null);
    }
  };
}
