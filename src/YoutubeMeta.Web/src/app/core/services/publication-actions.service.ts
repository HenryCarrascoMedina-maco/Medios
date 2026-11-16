import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PLATFORM_META } from '../constants/status.constants';
import { PublicationHttp } from '../http/api.http';
import { IPublication, ResolveAction } from '../models/api.models';
import { mapSettled } from '../utils/concurrency';
import { apiError } from '../utils/format';
import { canCancel, canRetry } from '../utils/publication-actions';
import { ConfirmService } from './confirm.service';
import { ToastService } from './toast.service';

/** Peticiones simultáneas en las acciones en lote. */
const BULK_CONCURRENCY = 3;

type PublicationRef = Pick<IPublication, 'id' | 'videoTitle' | 'connectionName' | 'target' | 'statusCode' | 'isSending'>;

/**
 * Reintentar y cancelar publicaciones (una o varias), con su confirmación y sus avisos. Devuelve
 * true si algo cambió, para que la pantalla recargue.
 */
@Injectable({ providedIn: 'root' })
export class PublicationActionsService {
  private readonly http = inject(PublicationHttp);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  async retry(p: PublicationRef): Promise<boolean> {
    try {
      await firstValueFrom(this.http.retry(p.id));
      this.toast.success('Reintento en cola.');
      return true;
    } catch (error) {
      this.toast.error(apiError(error));
      return false;
    }
  }

  /** Solo el primer comentario: la publicación ya está hecha y nunca se vuelve a publicar por esto. */
  async retryComment(p: PublicationRef): Promise<boolean> {
    try {
      await firstValueFrom(this.http.retryComment(p.id));
      this.toast.success('Se volverá a poner el primer comentario.');
      return true;
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudo reintentar el comentario.'));
      return false;
    }
  }

  async cancel(p: PublicationRef): Promise<boolean> {
    const accepted = await this.confirm.ask({
      title: 'Cancelar publicación',
      message: `«${p.videoTitle}» no se publicará en «${p.connectionName}» (${PLATFORM_META[p.target].label}).`,
      confirmText: 'Cancelar publicación',
      danger: true
    });
    if (!accepted) return false;
    try {
      await firstValueFrom(this.http.cancel(p.id));
      this.toast.success('Publicación cancelada.');
      return true;
    } catch (error) {
      this.toast.error(apiError(error));
      return false;
    }
  }

  /**
   * Resolver una publicación por revisar (o subir de nuevo una fallida). REUPLOAD pide confirmación:
   * si la plataforma sí la publicó, quedaría duplicada.
   */
  async resolve(p: PublicationRef, action: ResolveAction, externalUrl?: string | null): Promise<boolean> {
    if (action === 'REUPLOAD') {
      const accepted = await this.confirm.ask({
        title: 'Subir de nuevo desde cero',
        message: `Se volverá a subir «${p.videoTitle}» a «${p.connectionName}». Si ya estaba publicado, quedará duplicado: compruébalo antes en ${PLATFORM_META[p.target].label}.`,
        confirmText: 'Subir de nuevo'
      });
      if (!accepted) return false;
    }
    try {
      await firstValueFrom(this.http.resolve(p.id, action, externalUrl));
      this.toast.success(action === 'MARK_DONE' ? 'Marcada como publicada.' : 'Se subirá de nuevo.');
      return true;
    } catch (error) {
      this.toast.error(apiError(error));
      return false;
    }
  }

  /** Reintenta en lote las que lo admiten; un solo aviso con el resumen. */
  async retryMany(list: readonly PublicationRef[]): Promise<boolean> {
    return this.bulk(list.filter(canRetry), list.length, id => this.http.retry(id), { done: 'reintento en cola', verb: 'reintentar' });
  }

  /** Cancela en lote (con una confirmación) las que lo admiten. */
  async cancelMany(list: readonly PublicationRef[]): Promise<boolean> {
    const eligible = list.filter(canCancel);
    if (eligible.length > 0) {
      const accepted = await this.confirm.ask({
        title: `Cancelar ${eligible.length} ${eligible.length === 1 ? 'publicación' : 'publicaciones'}`,
        message: 'No se publicarán en sus cuentas. Las que ya se están enviando no se tocan.',
        confirmText: 'Cancelar publicaciones',
        danger: true
      });
      if (!accepted) return false;
    }
    return this.bulk(eligible, list.length, id => this.http.cancel(id), { done: 'cancelada', verb: 'cancelar' });
  }

  private async bulk(
    eligible: readonly PublicationRef[],
    requested: number,
    call: (id: number) => ReturnType<PublicationHttp['retry']>,
    text: { done: string; verb: string }
  ): Promise<boolean> {
    const skipped = requested - eligible.length;
    if (eligible.length === 0) {
      this.toast.warning(`Ninguna de las seleccionadas se puede ${text.verb}.`);
      return false;
    }
    const results = await mapSettled(eligible, BULK_CONCURRENCY, p => firstValueFrom(call(p.id)));
    const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [{ p: eligible[i], reason: r.reason as unknown }] : []));
    const ok = eligible.length - failed.length;

    const parts = [`${ok} de ${eligible.length}: ${text.done}.`];
    if (skipped > 0) parts.push(`${skipped} no se ${skipped === 1 ? 'podía' : 'podían'} ${text.verb}.`);
    if (failed.length > 0) parts.push(`Fallaron ${failed.length}: ${apiError(failed[0].reason)}${failed.length > 1 ? '…' : ''}`);
    const message = parts.join(' ');
    if (failed.length === 0 && skipped === 0) this.toast.success(message);
    else if (ok === 0) this.toast.error(message);
    else this.toast.warning(message);
    return ok > 0;
  }
}
