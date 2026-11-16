import { ChangeDetectionStrategy, Component, model, output, signal } from '@angular/core';
import { mediaKindOf } from '@core/utils/post-kind';
import { IconComponent } from '@shared/ui/icon.component';
import { MediaThumbComponent } from '@shared/ui/media-thumb.component';
import { IMediaItem } from './publish.models';

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Medios de la publicación en orden: miniatura, mover (flechas o arrastrar), quitar y texto
 * alternativo de las imágenes. «Añadir» pide al diálogo que abra la biblioteca.
 */
@Component({
  selector: 'ym-media-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, MediaThumbComponent],
  host: { class: 'block' },
  template: `
    <ol class="flex gap-2 overflow-x-auto pb-1" aria-label="Medios de la publicación">
      @for (item of items(); track item.video.id; let i = $index; let first = $first; let last = $last) {
        <li class="w-36 shrink-0 rounded-lg border bg-surface p-1.5 transition"
            [class]="dropIndex() === i ? 'border-brand ring-2 ring-brand/30' : 'border-line'"
            draggable="true" (dragstart)="dragStart($event, i)" (dragover)="dragOver($event, i)" (dragleave)="dropIndex.set(null)" (drop)="drop($event, i)" (dragend)="dropIndex.set(null)">
          <div class="relative overflow-hidden rounded-md">
            <ym-media-thumb [media]="item.video" [compact]="true" />
            <span class="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white">{{ i + 1 }}</span>
          </div>
          <div class="mt-1 truncate text-[11px] font-medium" [title]="item.video.title">{{ item.video.title }}</div>
          @if (isImage(item)) {
            <input class="input mt-1 !px-1.5 !py-0.5 text-[11px]" maxlength="300" placeholder="Texto alternativo" [attr.aria-label]="'Texto alternativo de ' + item.video.title"
                   [value]="item.alt" (input)="setAlt(i, $any($event.target).value)" />
          }
          <div class="mt-1 flex items-center justify-between">
            <span class="flex">
              <button type="button" class="btn btn-ghost btn-sm btn-icon" [disabled]="first" [attr.aria-label]="'Mover antes ' + item.video.title" (click)="move(i, i - 1)"><ym-icon name="arrowLeft" [size]="12" /></button>
              <button type="button" class="btn btn-ghost btn-sm btn-icon" [disabled]="last" [attr.aria-label]="'Mover después ' + item.video.title" (click)="move(i, i + 1)"><ym-icon name="arrowRight" [size]="12" /></button>
            </span>
            <button type="button" class="btn btn-ghost btn-sm btn-icon btn-danger" [attr.aria-label]="'Quitar ' + item.video.title" (click)="remove(i)"><ym-icon name="close" [size]="12" /></button>
          </div>
        </li>
      }
      <li class="shrink-0">
        <button type="button" class="grid h-full min-h-28 w-28 place-items-center rounded-lg border-2 border-dashed border-line-strong text-xs muted hover:border-brand hover:text-brand"
                (click)="add.emit()">
          <span class="grid justify-items-center gap-1"><ym-icon name="plus" [size]="18" /> {{ items().length ? 'Añadir' : 'Añadir medios' }}</span>
        </button>
      </li>
    </ol>
    @if (items().length > 1) { <p class="hint">Arrastra o usa las flechas para cambiar el orden: el primero es la portada.</p> }
  `
})
export class MediaStripComponent {
  readonly items = model.required<readonly IMediaItem[]>();
  readonly add = output<void>();

  protected readonly dropIndex = signal<number | null>(null);
  private dragFrom: number | null = null;

  protected isImage(item: IMediaItem): boolean {
    return mediaKindOf(item.video) === 'IMAGE';
  }

  protected move(from: number, to: number): void {
    this.items.set(moveItem(this.items(), from, to));
  }

  protected remove(index: number): void {
    this.items.set(this.items().filter((_, i) => i !== index));
  }

  protected setAlt(index: number, alt: string): void {
    this.items.set(this.items().map((item, i) => (i === index ? { ...item, alt } : item)));
  }

  protected dragStart(event: DragEvent, index: number): void {
    this.dragFrom = index;
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected dragOver(event: DragEvent, index: number): void {
    if (this.dragFrom === null) return;
    event.preventDefault();
    this.dropIndex.set(index);
  }

  protected drop(event: DragEvent, index: number): void {
    event.preventDefault();
    this.dropIndex.set(null);
    if (this.dragFrom !== null) this.move(this.dragFrom, index);
    this.dragFrom = null;
  }
}
