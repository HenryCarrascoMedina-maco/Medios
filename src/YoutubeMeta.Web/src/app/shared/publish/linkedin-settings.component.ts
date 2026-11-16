import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { LINKEDIN_PRIVACY } from '@core/constants/status.constants';
import { PrivacyStatus } from '@core/models/api.models';
import { isLinkedinPage } from '@core/utils/post-kind';
import { ChoiceGroupComponent, IChoice } from '@shared/ui/choice-group.component';
import { ScheduleFieldComponent } from '@shared/ui/schedule-field.component';
import { PlatformSettingsBase } from './platform-settings.base';

@Component({
  selector: 'ym-linkedin-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChoiceGroupComponent, ScheduleFieldComponent],
  host: { class: 'grid gap-3' },
  template: `
    @let a = account();
    <div>
      <div class="label">¿Quién puede verlo?</div>
      <ym-choice-group ariaLabel="Quién puede verlo en LinkedIn" [options]="privacyOptions()" [value]="draft().privacy ?? 'public'" (valueChange)="patch.emit({ privacy: $event })" />
      @if (page()) { <p class="hint">Las páginas de empresa siempre publican para cualquiera.</p> }
    </div>
    <ym-schedule-field [inputId]="'at-' + a.id" hint="opcional · lo publica YoutubeMeta a esa hora"
                       [value]="draft().publishAt" (valueChange)="patch.emit({ publishAt: $event })" />
    <p class="hint">El título solo se usa como nombre del video o del PDF. El acceso a LinkedIn caduca cada 60 días: la app avisa antes en Cuentas.</p>
  `
})
export class LinkedinSettingsComponent extends PlatformSettingsBase {
  protected readonly page = computed(() => isLinkedinPage(this.account()));
  /** «Solo mis contactos» solo existe en perfiles personales. */
  protected readonly privacyOptions = computed<IChoice<PrivacyStatus>[]>(() =>
    LINKEDIN_PRIVACY.map(p => ({ value: p.value, label: p.label, disabled: this.page() && p.value !== 'public' })));
}
