import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '@shared/ui/icon.component';
import { IconName } from '@shared/ui/icons';

/** Pestañas de Configuración: claves de las plataformas, bandeja y plantillas. */
@Component({
  selector: 'ym-settings-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  host: { class: 'mb-4 block' },
  template: `
    <nav class="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0" aria-label="Configuración">
      @for (tab of tabs; track tab.path) {
        <a [routerLink]="tab.path" [routerLinkActive]="activeClass" [routerLinkActiveOptions]="{ exact: tab.exact }"
           ariaCurrentWhenActive="page"
           class="-mb-px flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 no-underline hover:text-inherit dark:text-slate-400">
          <ym-icon [name]="tab.icon" [size]="14" /> {{ tab.label }}
        </a>
      }
    </nav>
  `
})
export class SettingsTabsComponent {
  protected readonly activeClass = '!border-brand font-semibold !text-inherit';
  /** Plantillas sigue activa dentro del editor (/settings/templates/:id). */
  protected readonly tabs: readonly { path: string; label: string; icon: IconName; exact: boolean }[] = [
    { path: '/settings', label: 'Plataformas', icon: 'key', exact: true },
    { path: '/settings/inbox', label: 'Bandeja', icon: 'inbox', exact: true },
    { path: '/settings/templates', label: 'Plantillas', icon: 'template', exact: false }
  ];
}
