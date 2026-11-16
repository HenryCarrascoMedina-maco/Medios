import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CheckboxComponent } from '@shared/ui/checkbox.component';
import { ScheduleFieldComponent } from '@shared/ui/schedule-field.component';
import { PlatformSettingsBase } from './platform-settings.base';

@Component({
  selector: 'ym-instagram-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CheckboxComponent, ScheduleFieldComponent],
  host: { class: 'grid gap-3' },
  template: `
    @if (kind() === 'VIDEO') {
      <div class="notice notice-info">Se publica como <b>Reel</b>. Lo ideal: vertical 9:16, MP4 (H.264 + AAC), de 3 s a 15 min y hasta 300 MB.</div>
      <ym-checkbox [checked]="draft().shareToFeed" (checkedChange)="patch.emit({ shareToFeed: $event })">Mostrar también en el feed del perfil (no solo en Reels)</ym-checkbox>
    } @else {
      <div class="notice notice-info">Se publica en el feed como {{ kind() === 'CAROUSEL' ? 'carrusel (se desliza de una imagen a otra)' : 'imagen' }}. Lo ideal: cuadrada o vertical 4:5, en JPG.</div>
    }
    <ym-schedule-field [inputId]="'at-' + account().id" hint="opcional · lo publica YoutubeMeta a esa hora"
                       [value]="draft().publishAt" (valueChange)="patch.emit({ publishAt: $event })" />
  `
})
export class InstagramSettingsComponent extends PlatformSettingsBase {}
