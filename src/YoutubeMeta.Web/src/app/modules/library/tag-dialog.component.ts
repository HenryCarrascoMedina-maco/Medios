import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { IVideo } from '@core/models/api.models';
import { TagStoreService } from '@core/services/tag-store.service';
import { ToastService } from '@core/services/toast.service';
import { apiError } from '@core/utils/format';
import { IconComponent } from '@shared/ui/icon.component';
import { ModalComponent } from '@shared/ui/modal.component';
import { TagEditorComponent } from '@shared/ui/tag-editor.component';

/** Añadir y quitar etiquetas a varios videos a la vez. */
@Component({
  selector: 'ym-tag-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, IconComponent, TagEditorComponent],
  template: `
    <ym-modal [title]="'Etiquetar ' + videos().length + (videos().length === 1 ? ' video' : ' videos')" [width]="520" [dirty]="add().length + remove().length > 0" (closed)="closed.emit()">
      <ym-icon modal-icon name="tag" [size]="20" class="text-brand" />
      <div>
        <div class="label">Añadir</div>
        <ym-tag-editor [(tags)]="add" [suggestions]="store.tags()" placeholder="Etiquetas a añadir (Intro o coma)" />
      </div>
      <div>
        <div class="label">Quitar <small>de los videos que la tengan</small></div>
        <ym-tag-editor [(tags)]="remove" [suggestions]="current()" placeholder="Etiquetas a quitar" />
        @if (current().length) {
          <div class="mt-2 flex flex-wrap gap-1">
            @for (t of current(); track t.tag) {
              @if (!remove().includes(t.tag)) {
                <button type="button" class="rounded-full border border-line px-2 py-0.5 text-xs hover:border-brand" (click)="markRemove(t.tag)">
                  #{{ t.tag }} <span class="muted">{{ t.videoCount }}</span>
                </button>
              }
            }
          </div>
        }
      </div>
      <p class="hint">Se guardan en minúsculas, sin # y con guiones en lugar de espacios.</p>
      <ng-container modal-footer>
        <button type="button" class="btn" (click)="closed.emit()">Cancelar</button>
        <button type="button" class="btn btn-primary" [disabled]="busy() || add().length + remove().length === 0" (click)="apply()">{{ busy() ? 'Guardando…' : 'Aplicar' }}</button>
      </ng-container>
    </ym-modal>
  `
})
export class TagDialogComponent {
  protected readonly store = inject(TagStoreService);
  private readonly toast = inject(ToastService);

  readonly videos = input.required<IVideo[]>();
  readonly closed = output<void>();
  readonly applied = output<void>();

  protected readonly add = signal<string[]>([]);
  protected readonly remove = signal<string[]>([]);
  protected readonly busy = signal(false);
  /** Etiquetas que ya tienen los videos elegidos, con cuántos la tienen. */
  protected readonly current = computed(() => {
    const counts = new Map<string, number>();
    for (const v of this.videos()) for (const t of v.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].map(([tag, videoCount]) => ({ tag, videoCount })).sort((a, b) => b.videoCount - a.videoCount);
  });

  protected markRemove(tag: string): void {
    this.remove.update(list => [...list, tag]);
  }

  protected async apply(): Promise<void> {
    this.busy.set(true);
    try {
      const changed = await this.store.updateMany(this.videos().map(v => v.id), this.add(), this.remove());
      this.toast.success(`Etiquetas actualizadas en ${changed} ${changed === 1 ? 'video' : 'videos'}.`);
      this.applied.emit();
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudieron cambiar las etiquetas.'));
    } finally {
      this.busy.set(false);
    }
  }
}
