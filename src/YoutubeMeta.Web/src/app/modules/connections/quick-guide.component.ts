import { ChangeDetectionStrategy, Component, OnInit, input, model, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { loadGuide } from '@core/guides/guide-loader';
import { GuidePlatform, IGuide } from '@core/guides/guide.models';
import { IconComponent } from '@shared/ui/icon.component';

let nextId = 0;

/** Guía rápida: solo los títulos de los pasos; cada uno abre la guía detallada con capturas. */
@Component({
  selector: 'ym-quick-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  host: { class: 'mt-3 block rounded-xl border border-line p-3' },
  template: `
    <div class="flex flex-wrap items-center gap-2">
      <button type="button" class="flex flex-1 items-center gap-1 whitespace-nowrap text-left text-sm font-semibold" [attr.aria-expanded]="open()" [attr.aria-controls]="listId"
              (click)="open.set(!open())">
        <ym-icon [name]="open() ? 'chevronDown' : 'chevronRight'" [size]="14" /> Guía rápida @if (guide(); as g) { ({{ g.steps.length }} pasos) }
      </button>
      <a class="btn btn-sm no-underline" [routerLink]="['/guides', platform()]"><ym-icon name="book" [size]="13" /> Guía detallada con capturas</a>
      <a class="btn btn-sm no-underline" [routerLink]="['/guides', platform()]" fragment="faqs"><ym-icon name="help" [size]="13" /> Problemas frecuentes</a>
    </div>
    @if (open()) {
      <ol [id]="listId" class="mt-3 space-y-1 text-[13px]">
        @for (step of guide()?.steps ?? []; track step.id; let i = $index) {
          <li>
            <a class="flex items-start gap-2 rounded-md px-1.5 py-1 text-inherit no-underline hover:bg-surface-hover"
               [routerLink]="['/guides', platform()]" [queryParams]="{ step: step.id }">
              <span class="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-muted text-[11px] font-bold">{{ i + 1 }}</span>
              <span class="flex-1">{{ step.title }} @if (step.optional) { <span class="muted">(opcional)</span> }</span>
              <ym-icon name="chevronRight" [size]="14" class="muted" />
            </a>
          </li>
        } @empty {
          <li class="text-xs muted" role="status">Cargando la guía…</li>
        }
      </ol>
    }
  `
})
export class QuickGuideComponent implements OnInit {
  readonly platform = input.required<GuidePlatform>();
  readonly open = model(false);

  protected readonly guide = signal<IGuide | null>(null);
  protected readonly listId = `ym-quick-guide-${++nextId}`;

  ngOnInit(): void {
    void loadGuide(this.platform()).then(guide => this.guide.set(guide)).catch(() => undefined);
  }
}
