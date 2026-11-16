import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TIKTOK_PRIVACY } from '@core/constants/status.constants';
import { PrivacyStatus, TiktokMode } from '@core/models/api.models';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { CheckboxComponent } from '@shared/ui/checkbox.component';
import { ChoiceGroupComponent, IChoice } from '@shared/ui/choice-group.component';
import { ScheduleFieldComponent } from '@shared/ui/schedule-field.component';
import { PlatformSettingsBase } from './platform-settings.base';
import { TiktokInfoState, tiktokErrorOf, tiktokInfoOf } from './publish.models';
import { ReqComponent } from '@shared/ui/req.component';

const MODES: readonly IChoice<TiktokMode>[] = [
  { value: 'DIRECT', label: 'Publicar directamente' },
  { value: 'INBOX', label: 'Enviar como borrador a la app' }
];

@Component({
  selector: 'ym-tiktok-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AccountAvatarComponent, CheckboxComponent, ChoiceGroupComponent, ScheduleFieldComponent, ReqComponent],
  host: { class: 'grid gap-3' },
  template: `
    @let a = account();
    @let d = draft();
    @let i = info();
    @let message = error();
    @if (state() === 'loading') {
      <p class="text-sm muted" role="status">Consultando la cuenta en TikTok…</p>
    } @else if (message) {
      <div class="notice notice-error">{{ message }} <button type="button" class="underline" (click)="reload.emit()">Reintentar</button></div>
    } @else if (i) {
      <div class="flex items-center gap-2 text-sm">
        <ym-account-avatar platform="TIKTOK" [name]="i.nickname" [url]="i.avatarUrl" [size]="28" />
        <span>Se publicará en <b>{{ i.nickname }}</b> @if (i.username) { <span class="muted">(&#64;{{ i.username }})</span> }</span>
      </div>
      <div>
        <div class="label">Cómo</div>
        <ym-choice-group ariaLabel="Cómo publicar en TikTok" [options]="modes" [value]="d.tiktokMode" (valueChange)="patch.emit({ tiktokMode: $event ?? 'DIRECT' })" />
        @if (d.tiktokMode === 'INBOX') { <p class="hint">Te llega una notificación en TikTok para terminarlo (música, efectos, privacidad). Como mucho 5 borradores pendientes.</p> }
      </div>

      @if (d.tiktokMode === 'DIRECT') {
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="label" [for]="'tt-privacy-' + a.id">¿Quién puede verlo? <ym-req /></label>
            <select [id]="'tt-privacy-' + a.id" class="input" (change)="onPrivacy($any($event.target).value)">
              <option value="" [selected]="!d.privacy">Elige…</option>
              @for (p of privacyOptions(); track p.value) {
                <option [value]="p.value" [selected]="p.value === d.privacy" [disabled]="p.disabled">{{ p.label }}</option>
              }
            </select>
          </div>
          <div>
            <div class="label">Permitir a los usuarios</div>
            <div class="flex flex-wrap gap-3">
              <ym-checkbox [disabled]="i.commentDisabled" [checked]="!d.disableComment && !i.commentDisabled" (checkedChange)="patch.emit({ disableComment: !$event })">Comentar</ym-checkbox>
              <ym-checkbox [disabled]="i.duetDisabled" [checked]="!d.disableDuet && !i.duetDisabled" (checkedChange)="patch.emit({ disableDuet: !$event })">Dúo</ym-checkbox>
              <ym-checkbox [disabled]="i.stitchDisabled" [checked]="!d.disableStitch && !i.stitchDisabled" (checkedChange)="patch.emit({ disableStitch: !$event })">Stitch</ym-checkbox>
            </div>
          </div>
        </div>
        <div class="grid gap-1.5 rounded-lg border border-line p-2.5">
          <ym-checkbox [checked]="d.commercial" (checkedChange)="patch.emit({ commercial: $event })"><b>Contenido comercial</b> <span class="text-xs muted">(promociona una marca, producto o servicio)</span></ym-checkbox>
          @if (d.commercial) {
            <div class="ml-6 grid gap-1.5">
              <div class="label !mb-0">¿De quién es? <ym-req /> <small>marca al menos una</small></div>
              <ym-checkbox [checked]="d.brandOrganic" (checkedChange)="patch.emit({ brandOrganic: $event })">Tu marca <span class="text-xs muted">→ se etiqueta «Contenido promocional»</span></ym-checkbox>
              <ym-checkbox [checked]="d.brandContent" (checkedChange)="patch.emit({ brandContent: $event })">Contenido de marca de un tercero <span class="text-xs muted">→ «Colaboración pagada»; no puede ser privado</span></ym-checkbox>
              @if (!d.brandOrganic && !d.brandContent) { <p class="text-xs text-amber-600">Marca al menos una de las dos opciones.</p> }
            </div>
          }
        </div>
      }
      <ym-schedule-field [inputId]="'at-' + a.id" hint="opcional · lo publica YoutubeMeta a esa hora"
                         [value]="d.publishAt" (valueChange)="patch.emit({ publishAt: $event })" />
      <p class="hint">TikTok puede tardar unos minutos en procesar el video. Sin la auditoría de TikTok, solo se publica como «Solo yo».</p>
    }
  `
})
export class TiktokSettingsComponent extends PlatformSettingsBase {
  readonly state = input<TiktokInfoState | undefined>(undefined);
  readonly reload = output<void>();

  protected readonly modes = MODES;
  protected readonly info = computed(() => tiktokInfoOf(this.state()));
  protected readonly error = computed(() => tiktokErrorOf(this.state()));

  /** Niveles que ofrece la cuenta; el contenido de marca de terceros no puede ser privado. */
  protected readonly privacyOptions = computed<IChoice<PrivacyStatus>[]>(() => {
    const d = this.draft();
    return (this.info()?.privacyOptions ?? [])
      .map(level => TIKTOK_PRIVACY[level])
      .filter(p => p != null)
      .map(p => ({ value: p.value, label: p.label, disabled: d.commercial && d.brandContent && p.value === 'private' }));
  });

  protected onPrivacy(value: string): void {
    this.patch.emit({ privacy: (value || null) as PrivacyStatus | null });
  }
}
