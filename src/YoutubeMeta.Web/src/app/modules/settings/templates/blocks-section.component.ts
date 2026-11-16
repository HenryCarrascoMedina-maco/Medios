import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TemplateHttp } from '@core/http/api.http';
import { ITextBlock } from '@core/models/api.models';
import { ConfirmService } from '@core/services/confirm.service';
import { TemplateStoreService } from '@core/services/template-store.service';
import { ToastService } from '@core/services/toast.service';
import { apiError } from '@core/utils/format';
import { ChipComponent } from '@shared/ui/chip.component';
import { IconComponent } from '@shared/ui/icon.component';
import { ReqComponent } from '@shared/ui/req.component';

const BLOCK_NAME = /^[a-z0-9_-]+$/;

/** Ajustes › Plantillas › Bloques: texto que se repite (hashtags, enlaces, avisos) y se inserta con #bloque:nombre. */
@Component({
  selector: 'ym-blocks-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChipComponent, IconComponent, ReqComponent],
  host: { class: 'block' },
  template: `
    <section class="card p-4" aria-labelledby="blk-title">
      <div class="mb-3 flex items-center gap-2">
        <h2 id="blk-title" class="flex flex-1 items-center gap-2 font-semibold"><ym-icon name="tag" [size]="16" class="muted" /> Bloques de hashtags</h2>
        <button type="button" class="btn btn-sm" (click)="edit(null)"><ym-icon name="plus" [size]="13" /> Nuevo</button>
      </div>
      <p class="mb-3 text-xs muted">Texto que se repite (hashtags, enlaces, avisos). En el editor de plantillas se inserta escribiendo <code>#</code> o con el botón «Bloque».</p>
      <div class="grid gap-2 lg:grid-cols-2">
        @for (b of store.blocks(); track b.id) {
          <div class="flex items-start gap-2 rounded-lg border border-line px-3 py-2">
            <div class="min-w-0 flex-1">
              <ym-chip class="font-mono">#bloque:{{ b.name }}</ym-chip>
              <p class="mt-1 line-clamp-2 whitespace-pre-line text-xs muted">{{ b.content }}</p>
            </div>
            <button type="button" class="btn btn-ghost btn-sm btn-icon" [attr.aria-label]="'Editar ' + b.name" (click)="edit(b)"><ym-icon name="edit" /></button>
            <button type="button" class="btn btn-ghost btn-sm btn-icon btn-danger" [attr.aria-label]="'Borrar ' + b.name" (click)="remove(b)"><ym-icon name="trash" /></button>
          </div>
        } @empty {
          <p class="text-sm muted">Sin bloques todavía.</p>
        }
      </div>

      @if (form(); as f) {
        <div class="mt-3 grid gap-2 rounded-xl border border-dashed border-line-strong p-3">
          <label class="label !mb-0" for="blk-name">Nombre <ym-req /> <small>minúsculas, números, - y _</small></label>
          <input id="blk-name" class="input font-mono" maxlength="50" [value]="f.name" (input)="patch({ name: $any($event.target).value })"
                 [attr.aria-invalid]="!!f.name && !validName()" />
          @if (f.name && !validName()) { <p class="text-xs text-red-500">Solo a-z, 0-9, guion y guion bajo.</p> }
          <label class="label !mb-0" for="blk-content">Contenido <ym-req /></label>
          <textarea id="blk-content" class="input min-h-20" [value]="f.content" (input)="patch({ content: $any($event.target).value })"></textarea>
          <div class="flex gap-2">
            <button type="button" class="btn btn-primary btn-sm" [disabled]="!validName() || !f.content.trim() || busy()" (click)="save()">{{ busy() ? 'Guardando…' : 'Guardar' }}</button>
            <button type="button" class="btn btn-ghost btn-sm" (click)="form.set(null)">Cancelar</button>
          </div>
        </div>
      }
    </section>
  `
})
export class BlocksSectionComponent {
  private readonly http = inject(TemplateHttp);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  protected readonly store = inject(TemplateStoreService);

  protected readonly form = signal<{ name: string; content: string } | null>(null);
  private readonly editingId = signal<number | null>(null);
  protected readonly busy = signal(false);
  protected readonly validName = computed(() => BLOCK_NAME.test(this.form()?.name ?? ''));

  protected edit(block: ITextBlock | null): void {
    this.editingId.set(block?.id ?? null);
    this.form.set({ name: block?.name ?? '', content: block?.content ?? '' });
  }

  protected patch(changes: Partial<{ name: string; content: string }>): void {
    this.form.update(f => f && { ...f, ...changes });
  }

  protected async save(): Promise<void> {
    const form = this.form();
    if (!form || !this.validName()) return;
    if (await this.run(() => firstValueFrom(this.http.saveBlock(form, this.editingId())), 'Bloque guardado.')) this.form.set(null);
  }

  protected async remove(block: ITextBlock): Promise<void> {
    if (await this.confirm.ask({ title: `Borrar #bloque:${block.name}`, message: 'Las plantillas que lo usen mostrarán el texto #bloque tal cual.', confirmText: 'Borrar', danger: true }))
      await this.run(() => firstValueFrom(this.http.deleteBlock(block.id)), 'Bloque borrado.');
  }

  private async run(request: () => Promise<unknown>, success: string): Promise<boolean> {
    this.busy.set(true);
    try {
      await request();
      await this.store.reload();
      this.toast.success(success);
      return true;
    } catch (error) {
      this.toast.error(apiError(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
