import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IGuideShot } from '@core/guides/guide.models';
import { fillVars } from './rich-text.pipe';

/**
 * Dibuja una captura esquemática de la pantalla (barra del navegador, menú lateral y contenido)
 * con marcas numeradas en rojo que coinciden con las acciones del paso.
 */
@Component({
  selector: 'ym-guide-shot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = shot();
    <figure class="overflow-hidden rounded-xl border border-slate-300 bg-white text-[12px] shadow-sm dark:border-line-strong dark:bg-surface">
      <div class="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-1.5 dark:border-line dark:bg-surface-hover">
        <span class="flex gap-1"><i class="h-2.5 w-2.5 rounded-full bg-red-400"></i><i class="h-2.5 w-2.5 rounded-full bg-amber-400"></i><i class="h-2.5 w-2.5 rounded-full bg-green-400"></i></span>
        <span class="min-w-0 flex-1 truncate rounded-md bg-white px-2 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-field dark:text-slate-400">{{ s.url }}</span>
      </div>

      @if (s.image) {
        <img [src]="s.image" [alt]="s.caption ?? ''" class="block w-full" loading="lazy" />
      } @else {
        <div class="flex min-h-40">
          @if (s.sidebar?.length) {
            <ul class="w-40 shrink-0 space-y-0.5 border-r border-slate-200 bg-slate-50 p-2 dark:border-line dark:bg-surface-hover max-sm:w-28">
              @for (item of s.sidebar; track item.label) {
                <li class="relative rounded px-2 py-1"
                    [class]="item.group ? 'pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400' : item.active ? 'bg-slate-800 font-semibold text-white dark:bg-slate-200 dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'"
                    [class.mark]="item.mark">
                  {{ item.label }}
                  @if (item.mark) { <span class="badge">{{ item.mark }}</span> }
                </li>
              }
            </ul>
          }

          <div class="min-w-0 flex-1 p-3">
            @if (s.title || s.buttons?.length) {
              <div class="mb-3 flex flex-wrap items-center gap-2">
                <b class="flex-1 text-[13px]">{{ s.title }}</b>
                @for (b of s.buttons; track b.label) {
                  <span class="relative rounded-md border px-2.5 py-1 font-semibold"
                        [class]="b.primary ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 dark:border-line-strong'"
                        [class.opacity-50]="b.disabled" [class.mark]="b.mark">
                    {{ b.label }}
                    @if (b.mark) { <span class="badge">{{ b.mark }}</span> }
                  </span>
                }
              </div>
            }

            <div class="space-y-1.5">
              @for (block of s.blocks; track $index) {
                @switch (block.kind) {
                  @case ('heading') { <div class="pt-1 font-semibold">{{ fill(block.text) }}</div> }
                  @case ('note') {
                    <div class="rounded-md px-2 py-1.5"
                         [class]="{ info: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300', warn: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300', ok: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300', error: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' }[block.tone]">
                      {{ fill(block.text) }}
                    </div>
                  }
                  @case ('row') {
                    <div class="relative flex items-center gap-2 rounded-md border px-2 py-1.5"
                         [class]="block.selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10' : 'border-line'" [class.mark]="block.mark">
                      <span class="min-w-0 flex-1"><b class="block truncate">{{ fill(block.label) }}</b>
                        @if (block.sub) { <span class="text-[11px] text-slate-500">{{ fill(block.sub) }}</span> }</span>
                      @if (block.button) { <span class="rounded border border-slate-300 px-2 py-0.5 dark:border-line-strong">{{ block.button }}</span> }
                      @if (block.mark) { <span class="badge">{{ block.mark }}</span> }
                    </div>
                  }
                  @case ('field') {
                    <div class="relative" [class.mark]="block.mark">
                      <div class="text-[11px] text-slate-500">{{ block.label }}</div>
                      <div class="truncate rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-line-strong dark:bg-field">{{ fill(block.value) }}</div>
                      @if (block.mark) { <span class="badge">{{ block.mark }}</span> }
                    </div>
                  }
                  @case ('secret') {
                    <div class="relative rounded-md border border-dashed border-slate-400 bg-slate-50 px-2 py-1.5 font-mono text-slate-500 dark:bg-field" [class.mark]="block.mark">
                      {{ fill(block.label) }}<span class="opacity-40">xxxxxxxxxxxxxxxxxxxxxxxx</span>
                      @if (block.mark) { <span class="badge">{{ block.mark }}</span> }
                    </div>
                  }
                  @case ('check') {
                    <div class="relative flex items-center gap-2 py-0.5" [class.mark]="block.mark">
                      <span class="grid h-3.5 w-3.5 place-items-center rounded-sm border text-[9px] text-white"
                            [class]="block.checked ? 'border-blue-600 bg-blue-600' : 'border-slate-400'">{{ block.checked ? '✓' : '' }}</span>
                      <span [class.font-semibold]="block.checked">{{ fill(block.label) }}</span>
                      @if (block.mark) { <span class="badge">{{ block.mark }}</span> }
                    </div>
                  }
                  @case ('option') {
                    <div class="relative flex items-start gap-2 rounded-md border px-2 py-1.5"
                         [class]="block.checked ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10' : 'border-line'" [class.mark]="block.mark">
                      <span class="mt-0.5 h-3 w-3 shrink-0 rounded-full border-2" [class]="block.checked ? 'border-blue-600 bg-blue-600 shadow-[inset_0_0_0_2px_white]' : 'border-slate-400'"></span>
                      <span><b class="block">{{ fill(block.label) }}</b>
                        @if (block.sub) { <span class="text-[11px] text-slate-500">{{ fill(block.sub) }}</span> }</span>
                      @if (block.mark) { <span class="badge">{{ block.mark }}</span> }
                    </div>
                  }
                }
              }
            </div>
          </div>
        </div>
      }

      @if (s.caption) {
        <figcaption class="border-t border-slate-200 px-3 py-2 text-[12px] text-slate-500 dark:border-line dark:text-slate-400">{{ s.caption }}</figcaption>
      }
    </figure>
  `,
  styles: `
    .mark { outline: 2px solid #dc2626; outline-offset: 2px; border-radius: 6px; }
    .badge {
      position: absolute; top: -9px; right: -9px; z-index: 1;
      display: grid; place-items: center; width: 18px; height: 18px;
      border-radius: 9999px; background: #dc2626; color: #fff;
      font-size: 10px; font-weight: 700; box-shadow: 0 0 0 2px #fff;
    }
  `
})
export class GuideShotComponent {
  readonly shot = input.required<IGuideShot>();
  readonly vars = input<Record<string, string>>({});

  protected fill(text: string): string {
    return fillVars(text, this.vars());
  }
}
