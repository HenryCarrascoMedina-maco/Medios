import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PLATFORM_META } from '@core/constants/status.constants';
import { Platform } from '@core/models/api.models';
import { IconComponent } from './icon.component';

/**
 * Foto de la cuenta con el glifo de su plataforma en la esquina. Sin foto, las iniciales; sin nombre,
 * el glifo de la plataforma a tamaño completo (avatar de plataforma).
 */
@Component({
  selector: 'ym-account-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <span class="relative inline-block shrink-0" [style.width.px]="size()" [style.height.px]="size()">
      @if (url()) {
        <img [src]="url()" alt="" class="h-full w-full rounded-full object-cover" referrerpolicy="no-referrer" />
      } @else if (initials()) {
        <span class="grid h-full w-full place-items-center rounded-full font-bold text-white" [class]="meta().bg" [style.font-size.px]="size() * 0.32">{{ initials() }}</span>
      } @else {
        <span class="grid h-full w-full place-items-center rounded-full text-white" [class]="meta().bg"><ym-icon [name]="meta().icon" [size]="size() * 0.5" /></span>
      }
      @if (badge() && (url() || initials())) {
        <span class="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full text-white ring-2 ring-surface" [class]="meta().bg">
          <ym-icon [name]="meta().icon" [size]="9" />
        </span>
      }
    </span>
  `
})
export class AccountAvatarComponent {
  readonly platform = input.required<Platform>();
  readonly name = input('');
  readonly url = input<string | null>(null);
  readonly size = input(36);
  readonly badge = input(true);

  protected readonly meta = computed(() => PLATFORM_META[this.platform()]);
  protected readonly initials = computed(() =>
    this.name().replace(/[@#]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase());
}
