import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TELEGRAM_CLOUD_MAX_MB } from '@core/utils/publication-rules';
import { CheckboxComponent } from '@shared/ui/checkbox.component';
import { ScheduleFieldComponent } from '@shared/ui/schedule-field.component';
import { PlatformSettingsBase } from './platform-settings.base';

@Component({
  selector: 'ym-telegram-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CheckboxComponent, ScheduleFieldComponent],
  host: { class: 'grid gap-3' },
  template: `
    @let a = account();
    <p class="text-xs muted">Bot {{ a.credentialName }} · admite hasta {{ a.uploadLimitMb ?? defaultLimitMb }} MB. El texto es la descripción (o el título si está vacía).</p>
    <div class="flex flex-wrap gap-4">
      <ym-checkbox [checked]="draft().disableNotification" (checkedChange)="patch.emit({ disableNotification: $event })">Publicar en silencio (sin sonido de aviso)</ym-checkbox>
      <ym-checkbox [checked]="draft().protectContent" (checkedChange)="patch.emit({ protectContent: $event })">Impedir reenviar y guardar</ym-checkbox>
    </div>
    <ym-schedule-field [inputId]="'at-' + a.id" hint="opcional · lo publica YoutubeMeta a esa hora"
                       [value]="draft().publishAt" (valueChange)="patch.emit({ publishAt: $event })" />
  `
})
export class TelegramSettingsComponent extends PlatformSettingsBase {
  protected readonly defaultLimitMb = TELEGRAM_CLOUD_MAX_MB;
}
