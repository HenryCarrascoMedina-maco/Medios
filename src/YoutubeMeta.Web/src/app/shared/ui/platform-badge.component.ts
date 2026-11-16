import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PLATFORM_META } from '@core/constants/status.constants';
import { ContactSource } from '@core/models/api.models';
import { IconComponent } from './icon.component';

/** La agenda no es una red: contactos dados de alta a mano. */
const AGENDA_META = { icon: 'user', text: 'text-slate-500 dark:text-slate-400', label: 'Agenda' } as const;

/** Glifo de la plataforma con su color y, opcionalmente, su nombre (encabezados, pestañas, tablas). También la agenda. */
@Component({
  selector: 'ym-platform-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'inline-flex min-w-0 items-center gap-1.5' },
  template: `
    <ym-icon [name]="meta().icon" [size]="size()" [class]="meta().text" [label]="showLabel() ? null : meta().label" />
    @if (showLabel()) { <span class="truncate">{{ meta().label }}</span> }
  `
})
export class PlatformBadgeComponent {
  readonly platform = input.required<ContactSource>();
  readonly showLabel = input(true);
  readonly size = input(16);

  protected readonly meta = computed(() => {
    const platform = this.platform();
    return platform === 'AGENDA' ? AGENDA_META : PLATFORM_META[platform];
  });
}
