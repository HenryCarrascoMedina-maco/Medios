import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IPublication } from '@core/models/api.models';
import { canCancel, canRetry } from '@core/utils/publication-actions';
import { IconComponent } from '@shared/ui/icon.component';

/** Botones de una fila de Publicaciones (los mismos en la tabla y en las tarjetas de móvil). */
@Component({
  selector: 'ym-publication-row-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  host: { class: 'inline-flex flex-wrap items-center justify-end gap-1' },
  template: `
    @let p = publication();
    @if (canRetry(p)) {
      <button type="button" class="btn btn-sm btn-icon" title="Reintentar" [attr.aria-label]="'Reintentar #' + p.id" (click)="retry.emit()"><ym-icon name="retry" /></button>
    }
    @if (canCancel(p)) {
      <button type="button" class="btn btn-ghost btn-sm btn-icon" title="Cancelar" [attr.aria-label]="'Cancelar #' + p.id" (click)="cancel.emit()"><ym-icon name="close" /></button>
    }
    @if (p.commentPending) {
      <button type="button" class="btn btn-sm" title="La publicación está hecha; solo falta el primer comentario" (click)="retryComment.emit()"><ym-icon name="message" [size]="12" /> Reintentar comentario</button>
    }
    @if (p.statusCode === 'NEEDS_RECONNECT') { <a routerLink="/connections" class="btn btn-ghost btn-sm no-underline">Reconectar</a> }
  `
})
export class PublicationRowActionsComponent {
  readonly publication = input.required<IPublication>();
  readonly retry = output<void>();
  readonly cancel = output<void>();
  /** Solo el primer comentario (la publicación ya salió). */
  readonly retryComment = output<void>();

  protected readonly canRetry = canRetry;
  protected readonly canCancel = canCancel;
}
