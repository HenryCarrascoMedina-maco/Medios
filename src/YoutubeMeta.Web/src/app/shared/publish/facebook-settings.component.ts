import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RulesService } from '@core/services/rules.service';
import { ScheduleFieldComponent } from '@shared/ui/schedule-field.component';
import { PlatformSettingsBase } from './platform-settings.base';

@Component({
  selector: 'ym-facebook-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScheduleFieldComponent],
  host: { class: 'grid gap-3' },
  template: `
    <ym-schedule-field [inputId]="'at-' + account().id" [hint]="hint()" [minLeadMs]="minLeadMs()"
                       [value]="draft().publishAt" (valueChange)="patch.emit({ publishAt: $event })">
      <p class="hint">Vacío = se publica al terminar de procesarse. Programado = Facebook lo publica a esa hora.</p>
    </ym-schedule-field>
  `
})
export class FacebookSettingsComponent extends PlatformSettingsBase {
  private readonly rules = inject(RulesService).rules;
  protected readonly minLeadMs = computed(() => (this.rules().facebookScheduleMinMinutes + 1) * 60_000);
  protected readonly hint = computed(() => `opcional · de ${this.rules().facebookScheduleMinMinutes} minutos a ${this.rules().scheduleMaxMonths} meses`);
}
