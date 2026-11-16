import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IVideo } from '@core/models/api.models';
import { formatBytes, formatDuration } from '@core/utils/format';
import { mediaKindOf } from '@core/utils/post-kind';
import { MediaThumbComponent } from '@shared/ui/media-thumb.component';
import { StatusChipComponent } from '@shared/ui/status-chip.component';

export type LibraryLayout = 'grid' | 'list';

/**
 * Medio de la biblioteca (video, imagen o PDF) en cuadrícula o en lista. En modo selección, un clic (o Mayús+clic para un
 * tramo) marca el video en lugar de abrirlo.
 */
@Component({
  selector: 'ym-video-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MediaThumbComponent, StatusChipComponent],
  host: { class: 'group relative block' },
  template: `
    @let v = video();
    <label class="absolute left-2 top-2 z-10 grid h-6 w-6 cursor-pointer place-items-center rounded-md bg-black/50 transition"
           [class]="selecting() || selected() ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'">
      <input type="checkbox" class="h-4 w-4 cursor-pointer" [checked]="selected()" [attr.aria-label]="'Seleccionar ' + v.title"
             (click)="$event.preventDefault(); toggled.emit($event.shiftKey)" />
    </label>
    <a [routerLink]="['/videos', v.id]" (click)="onClick($event)"
       class="card flex overflow-hidden text-inherit no-underline transition hover:shadow-md"
       [class]="layout() === 'grid' ? 'flex-col hover:-translate-y-0.5' : 'flex-row items-center gap-3 p-2'"
       [class.ring-2]="selected()" [class.ring-brand]="selected()">
      <ym-media-thumb [class]="layout() === 'grid' ? '' : 'w-36 shrink-0 rounded-md'" [media]="v" [showPlay]="layout() === 'grid'" [showKind]="kind() !== 'VIDEO'" />
      <div class="min-w-0 flex-1" [class.px-3]="layout() === 'grid'" [class.py-2.5]="layout() === 'grid'">
        <div class="truncate text-sm font-semibold" [title]="v.title">{{ v.title }}</div>
        <div class="text-xs muted">
          {{ size() }}@if (v.width) { · {{ v.width }}×{{ v.height }} }@if (layout() === 'list' && kind() === 'VIDEO') { · {{ duration() }} }@if (kind() === 'DOCUMENT') { · PDF }
        </div>
        @if (v.tags?.length) {
          <div class="mt-1 flex flex-wrap gap-1">
            @for (t of v.tags; track t) { <span class="rounded bg-surface-muted px-1.5 text-[11px] muted">#{{ t }}</span> }
          </div>
        }
        <div class="mt-2 flex flex-wrap gap-1.5">
          @for (p of v.publications; track p.connectionId) {
            <ym-status-chip [status]="p.statusCode" [platform]="p.target" [account]="p.connectionName" [percent]="p.percent" />
          } @empty {
            <ym-status-chip [status]="null" />
          }
        </div>
      </div>
    </a>
  `
})
export class VideoCardComponent {
  readonly video = input.required<IVideo>();
  readonly layout = input<LibraryLayout>('grid');
  readonly selecting = input(false);
  readonly selected = input(false);
  /** Alternar selección; true = con Mayús (seleccionar tramo). */
  readonly toggled = output<boolean>();

  protected readonly kind = computed(() => mediaKindOf(this.video()));

  protected size(): string {
    return formatBytes(this.video().sizeBytes);
  }

  protected duration(): string {
    return formatDuration(this.video().durationSec);
  }

  protected onClick(event: MouseEvent): void {
    if (!this.selecting() && !event.shiftKey) return;
    event.preventDefault();
    this.toggled.emit(event.shiftKey);
  }
}
