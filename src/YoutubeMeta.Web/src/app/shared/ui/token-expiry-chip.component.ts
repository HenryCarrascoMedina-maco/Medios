import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ClockService } from '@core/services/clock.service';
import { TOKEN_WARN_DAYS, tokenExpiry } from '@core/utils/token-expiry';
import { ChipComponent } from './chip.component';
import { IconComponent } from './icon.component';

/** «Caduca en N días» / «Caducada · Reconectar» para accesos que no se renuevan solos. Nada si falta mucho. */
@Component({
  selector: 'ym-token-expiry-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChipComponent, IconComponent],
  host: { class: 'contents' },
  template: `
    @if (expiry(); as e) {
      <ym-chip [tone]="e.tone" [attr.title]="hint()"><ym-icon [name]="e.expired ? 'error' : 'clock'" [size]="11" /> {{ e.label }}</ym-chip>
    }
  `
})
export class TokenExpiryChipComponent {
  private readonly clock = inject(ClockService);

  readonly expiresAt = input<string | null | undefined>(null);
  readonly warnDays = input(TOKEN_WARN_DAYS);

  protected readonly expiry = computed(() => tokenExpiry(this.expiresAt(), this.clock.now(), this.warnDays()));
  protected readonly hint = computed(() =>
    this.expiry()?.expired ? 'El acceso caducó: reconecta la cuenta; lo pendiente continúa solo.' : 'La plataforma no deja renovar el acceso sola: reconecta antes de que caduque.');
}
