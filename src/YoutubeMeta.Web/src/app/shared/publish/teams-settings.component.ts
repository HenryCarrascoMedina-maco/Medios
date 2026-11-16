import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { isTeamsWebhook } from '@core/utils/post-kind';
import { CheckboxComponent } from '@shared/ui/checkbox.component';
import { ScheduleFieldComponent } from '@shared/ui/schedule-field.component';
import { PlatformSettingsBase } from './platform-settings.base';

@Component({
  selector: 'ym-teams-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CheckboxComponent, ScheduleFieldComponent],
  host: { class: 'grid gap-3' },
  template: `
    @let a = account();
    @if (webhook()) {
      <div class="notice notice-info">Canal conectado por webhook: el mensaje lo firma «Workflows» y solo admite texto, enlace e imágenes. Si se corta la red al enviar, queda en <b>Revisar</b> para que lo compruebes.</div>
    } @else {
      <ym-checkbox [checked]="draft().teamsMentionChannel" (checkedChange)="patch.emit({ teamsMentionChannel: $event })">Avisar a todo el canal (&#64;canal) <span class="text-xs muted">notifica a todos los miembros</span></ym-checkbox>
    }
    <ym-schedule-field [inputId]="'at-' + a.id" hint="opcional · lo publica YoutubeMeta a esa hora"
                       [value]="draft().publishAt" (valueChange)="patch.emit({ publishAt: $event })" />
    <p class="hint">El título es el asunto del mensaje. @if (!webhook()) { El mensaje aparece con tu nombre; los videos y PDF se guardan en «Archivos» del canal. }</p>
  `
})
export class TeamsSettingsComponent extends PlatformSettingsBase {
  protected readonly webhook = computed(() => isTeamsWebhook(this.account()));
}
