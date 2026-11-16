import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { IPublication } from '@core/models/api.models';
import { PublicationActionsService } from '@core/services/publication-actions.service';
import { canResolve, canReupload } from '@core/utils/publication-actions';
import { IconComponent } from './icon.component';

type ResolvablePublication = Pick<IPublication, 'id' | 'videoTitle' | 'connectionName' | 'target' | 'statusCode' | 'isSending'>;

/**
 * Acciones de una publicación por revisar: «Ya está publicado» (con enlace opcional) y «Publicar de
 * nuevo». En una fallida solo ofrece «Subir de nuevo desde cero». Emite `changed` para recargar.
 */
@Component({
  selector: 'ym-publication-resolve',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'contents' },
  template: `
    @let p = publication();
    @if (review()) {
      @if (marking()) {
        <span class="flex w-full flex-wrap items-center gap-1.5">
          <input type="url" class="input !py-1 min-w-0 flex-1 text-xs" placeholder="Enlace a la publicación (opcional)" aria-label="Enlace a la publicación"
                 [value]="url()" (input)="url.set($any($event.target).value)" (keydown.enter)="markDone()" (keydown.escape)="marking.set(false)" />
          <button type="button" class="btn btn-primary btn-sm" [disabled]="busy()" (click)="markDone()">Confirmar</button>
          <button type="button" class="btn btn-ghost btn-sm" (click)="marking.set(false)">Cancelar</button>
        </span>
      } @else {
        <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="marking.set(true)"><ym-icon name="check" [size]="13" /> Ya está publicado</button>
        <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="reupload()"><ym-icon name="upload" [size]="13" /> Publicar de nuevo</button>
      }
    } @else if (reuploadable()) {
      <button type="button" class="btn btn-ghost btn-sm" [class.btn-icon]="compact()" [disabled]="busy()" (click)="reupload()"
              title="Subir de nuevo desde cero" [attr.aria-label]="'Subir de nuevo desde cero #' + p.id">
        <ym-icon name="upload" [size]="13" />@if (!compact()) { Subir de nuevo desde cero }
      </button>
    }
  `
})
export class PublicationResolveComponent {
  private readonly actions = inject(PublicationActionsService);

  readonly publication = input.required<ResolvablePublication>();
  /** Solo ícono para la acción secundaria (tablas). */
  readonly compact = input(false);
  readonly changed = output<void>();

  protected readonly review = computed(() => canResolve(this.publication()));
  protected readonly reuploadable = computed(() => canReupload(this.publication()));
  protected readonly marking = signal(false);
  protected readonly url = signal('');
  protected readonly busy = signal(false);

  protected async markDone(): Promise<void> {
    await this.run(() => this.actions.resolve(this.publication(), 'MARK_DONE', this.url().trim()));
    this.marking.set(false);
  }

  protected async reupload(): Promise<void> {
    await this.run(() => this.actions.resolve(this.publication(), 'REUPLOAD'));
  }

  private async run(action: () => Promise<boolean>): Promise<void> {
    this.busy.set(true);
    try {
      if (await action()) this.changed.emit();
    } finally {
      this.busy.set(false);
    }
  }
}
