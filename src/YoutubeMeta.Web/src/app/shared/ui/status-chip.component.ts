import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PLATFORM_META, STATUS_META } from '@core/constants/status.constants';
import { Platform, PublicationStatus } from '@core/models/api.models';
import { ChipComponent } from './chip.component';
import { IconComponent } from './icon.component';

/** Estado de una publicación; con plataforma y cuenta, muestra a dónde va (▶ Canal A · Publicado). */
@Component({
  selector: 'ym-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChipComponent, IconComponent],
  template: `
    <ym-chip [tone]="meta().tone" [attr.title]="title()">
      @if (platformMeta(); as p) { <ym-icon [name]="p.icon" [size]="11" [class]="p.text" /> }
      @if (meta().icon; as icon) { <ym-icon [name]="icon" [size]="11" /> }
      @if (account()) { <span class="max-w-[9rem] truncate font-medium">{{ account() }}</span> · }
      <span>{{ label() }}</span>
    </ym-chip>
  `
})
export class StatusChipComponent {
  readonly status = input<PublicationStatus | null>(null);
  readonly platform = input<Platform | null>(null);
  readonly account = input<string | null>(null);
  readonly percent = input<number | null>(null);

  protected readonly meta = computed(() => STATUS_META[this.status() ?? 'NONE']);
  protected readonly platformMeta = computed(() => {
    const platform = this.platform();
    return platform ? PLATFORM_META[platform] : null;
  });
  protected readonly label = computed(() => {
    const percent = this.percent();
    return this.status() === 'UPLOADING' && percent != null ? `${this.meta().label} ${percent}%` : this.meta().label;
  });
  protected readonly title = computed(() => [this.platformMeta()?.label, this.account(), this.label()].filter(Boolean).join(' · '));
}
