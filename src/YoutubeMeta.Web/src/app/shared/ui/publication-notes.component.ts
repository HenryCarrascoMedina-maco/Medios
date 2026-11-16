import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IPublication } from '@core/models/api.models';

type NotesSource = Pick<IPublication, 'statusCode' | 'errorMessage' | 'warning' | 'nextAttemptAt'>;

/**
 * Aviso y error de una publicación, con la hora del próximo intento si está esperando.
 * `boxed` los pinta como avisos (detalle del video); si no, como texto (tabla y tarjetas).
 */
@Component({
  selector: 'ym-publication-notes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  host: { class: 'block' },
  template: `
    @let p = publication();
    @if (p.warning) {
      <div [class]="boxed() ? 'notice notice-warn mt-2' : 'text-xs text-amber-600 dark:text-amber-400'">{{ p.warning }}</div>
    }
    @if (showError()) {
      <div [class]="errorClass()">
        {{ p.errorMessage }}
        @if (waiting() && p.nextAttemptAt) { · {{ boxed() ? 'próximo intento ' : '' }}{{ p.nextAttemptAt | date: 'dd/MM HH:mm' }} }
      </div>
    }
  `
})
export class PublicationNotesComponent {
  readonly publication = input.required<NotesSource>();
  readonly boxed = input(false);

  protected readonly showError = computed(() => !!this.publication().errorMessage && this.publication().statusCode !== 'DONE');
  /** En cola o esperando cuota: el error es temporal y habrá otro intento. */
  protected readonly waiting = computed(() => this.publication().statusCode === 'PENDING' || this.publication().statusCode === 'WAITING_QUOTA');
  protected readonly errorClass = computed(() => {
    const temporary = this.waiting();
    if (this.boxed()) return `notice mt-2 ${temporary ? 'notice-warn' : 'notice-error'}`;
    return `text-xs ${temporary ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`;
  });
}
