import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CREDENTIAL_SOURCE_META, PLATFORM_META } from '@core/constants/status.constants';
import { GuidePlatform } from '@core/guides/guide.models';
import { IClientCredentialSource, Platform } from '@core/models/api.models';
import { ChipComponent } from '@shared/ui/chip.component';
import { IconComponent } from '@shared/ui/icon.component';
import { TokenExpiryChipComponent } from '@shared/ui/token-expiry-chip.component';
import { ReqComponent } from '@shared/ui/req.component';

/** Claves de apps que se guardan en Ajustes (LinkedIn tiene dos: perfil y páginas de empresa; META es la de la bandeja). */
export type ClientPlatform = 'YOUTUBE' | 'TIKTOK' | 'LINKEDIN' | 'LINKEDIN_ORG' | 'TEAMS' | 'META';

/** Plataforma (colores, icono y si está activa) de cada clave. La app de Meta sirve a Facebook, Instagram y WhatsApp. */
export const CLIENT_PLATFORM: Record<ClientPlatform, Platform> = {
  YOUTUBE: 'YOUTUBE', TIKTOK: 'TIKTOK', LINKEDIN: 'LINKEDIN', LINKEDIN_ORG: 'LINKEDIN', TEAMS: 'TEAMS', META: 'FACEBOOK'
};

/** Formulario de un cliente OAuth. El secreto nunca vuelve del servidor. */
export interface IClientForm {
  publicId: string;
  secret: string;
  /** Teams: Id. de directorio (inquilino). */
  tenantId?: string;
  /** Teams: caducidad del secreto (yyyy-MM-dd). */
  secretExpiresAt?: string;
}

/** Un GUID como los de Microsoft Entra (Id. de aplicación o de inquilino). */
export const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Días antes de que caduque el secreto en los que se avisa. */
export const SECRET_WARN_DAYS = 30;

export interface IClientCardText {
  title: string;
  idLabel: string;
  idHint: string;
  secretHint: string;
  /** Paso de la guía que explica de dónde salen los datos. */
  step: string;
  /** Pide además el inquilino (Teams). */
  tenantLabel?: string;
  tenantHint?: string;
  /** Pide la fecha de caducidad del secreto (Teams). */
  secretExpiry?: boolean;
  /** Guía que explica los datos, si no es la de su plataforma (la app de Meta: la de WhatsApp). */
  guide?: GuidePlatform;
}

/** Tarjeta de un cliente OAuth en Ajustes › Plataformas. La página guarda y borra. */
@Component({
  selector: 'ym-client-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, ChipComponent, IconComponent, TokenExpiryChipComponent, ReqComponent],
  host: { class: 'block' },
  template: `
    @let src = source();
    @let f = form();
    @let t = text();
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <h2 class="flex flex-1 items-center gap-2 font-semibold"><ym-icon [name]="meta().icon" [size]="18" [class]="meta().text" /> {{ t.title }}</h2>
      <ym-chip [tone]="sourceMeta().tone">{{ sourceMeta().label }}</ym-chip>
    </div>

    <div class="grid gap-3">
      <div>
        <label class="label" [for]="'id-' + platform()">{{ t.idLabel }} <ym-req /> <small>{{ t.idHint }}</small></label>
        <input [id]="'id-' + platform()" class="input font-mono text-xs" [value]="f.publicId" (input)="patchForm.emit({ publicId: $any($event.target).value })" autocomplete="off" spellcheck="false" />
      </div>
      <div>
        <label class="label" [for]="'secret-' + platform()">Secreto @if (secretRequired()) { <ym-req /> } <small>{{ src.source === 'DATABASE' ? 'déjalo vacío para conservar el guardado' : t.secretHint }}</small></label>
        <input [id]="'secret-' + platform()" type="password" class="input font-mono text-xs" [value]="f.secret" (input)="patchForm.emit({ secret: $any($event.target).value })"
               [placeholder]="src.source === 'DATABASE' ? '•••••••• (guardado)' : ''" autocomplete="new-password" spellcheck="false" />
      </div>
      @if (t.tenantLabel) {
        <div>
          <label class="label" [for]="'tenant-' + platform()">{{ t.tenantLabel }} <ym-req /> <small>{{ t.tenantHint }}</small></label>
          <input [id]="'tenant-' + platform()" class="input font-mono text-xs" [value]="f.tenantId ?? ''" (input)="patchForm.emit({ tenantId: $any($event.target).value })"
                 placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off" spellcheck="false" />
          @if (tenantInvalid()) { <p class="hint text-red-500">Debe tener el formato 00000000-0000-0000-0000-000000000000.</p> }
        </div>
      }
      @if (t.secretExpiry) {
        <div>
          <label class="label" [for]="'expiry-' + platform()">Caduca el secreto <small>la fecha que pusiste al crearlo; avisamos un mes antes</small></label>
          <div class="flex flex-wrap items-center gap-2">
            <input [id]="'expiry-' + platform()" type="date" class="input !w-auto" [value]="f.secretExpiresAt ?? ''" (input)="patchForm.emit({ secretExpiresAt: $any($event.target).value })" />
            <ym-token-expiry-chip [expiresAt]="src.secretExpiresAt" [warnDays]="secretWarnDays" />
          </div>
        </div>
      }
      @for (value of copyValues(); track value.label) {
        <div>
          <div class="label">{{ value.label }} <small>{{ value.hint }}</small></div>
          <div class="flex flex-wrap items-center gap-2">
            <code class="break-all rounded bg-field px-2 py-1 text-xs">{{ value.text }}</code>
            <button type="button" class="btn btn-sm" (click)="copy.emit(value.text)">Copiar</button>
          </div>
        </div>
      }
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn btn-sm" [class]="meta().btn" [disabled]="!f.publicId.trim() || (secretRequired() && !f.secret.trim()) || tenantMissing() || tenantInvalid() || busy()" (click)="save.emit()">{{ saving() ? 'Guardando…' : 'Guardar' }}</button>
        @if (src.source === 'DATABASE') {
          <button type="button" class="btn btn-ghost btn-sm btn-danger" (click)="remove.emit()">Borrar la guardada aquí</button>
          <span class="text-xs muted">Actualizada {{ src.updatedAt | date: 'dd/MM/yyyy HH:mm' }}</span>
        }
        <div class="flex-1"></div>
        <a class="text-xs" [routerLink]="['/guides', t.guide ?? meta().guide]" [queryParams]="{ step: t.step }">¿De dónde saco estos datos?</a>
      </div>
      <p class="hint">Si cambias de cliente, las cuentas que se conectaron con el anterior pedirán reconectarse.</p>
    </div>
  `
})
export class ClientCardComponent {
  readonly platform = input.required<ClientPlatform>();
  readonly source = input.required<IClientCredentialSource>();
  readonly form = input.required<IClientForm>();
  readonly text = input.required<IClientCardText>();
  /** Hay otra acción en curso en la página. */
  readonly busy = input(false);
  /** Esta tarjeta se está guardando. */
  readonly saving = input(false);

  readonly patchForm = output<Partial<IClientForm>>();
  readonly save = output<void>();
  readonly remove = output<void>();
  readonly copy = output<string>();

  protected readonly meta = computed(() => PLATFORM_META[CLIENT_PLATFORM[this.platform()]]);
  protected readonly sourceMeta = computed(() => CREDENTIAL_SOURCE_META[this.source().source]);
  /** Lo que se pega en la consola de la plataforma: URI de redirección (OAuth) o URL y texto del webhook (Meta). */
  protected readonly copyValues = computed(() => {
    const src = this.source();
    return [
      { label: 'URI de redirección', hint: 'pégala igual en la consola de la plataforma', text: src.redirectUri },
      { label: 'URL del webhook', hint: 'en tu app de Meta › Webhooks', text: src.webhookUrl },
      { label: 'Texto de verificación', hint: 'Meta lo pide al guardar el webhook', text: src.verifyToken }
    ].filter((v): v is { label: string; hint: string; text: string } => !!v.text);
  });
  protected readonly secretWarnDays = SECRET_WARN_DAYS;
  /** Sin una clave guardada en BD, la API exige el secreto (CredentialService.SaveOAuthClientAsync). */
  protected readonly secretRequired = computed(() => this.source().source !== 'DATABASE');
  /** Teams: la API exige el inquilino y que sea un GUID. */
  protected readonly tenantMissing = computed(() => !!this.text().tenantLabel && !this.form().tenantId?.trim());
  protected readonly tenantInvalid = computed(() => {
    const tenant = this.form().tenantId?.trim();
    return !!this.text().tenantLabel && !!tenant && !GUID_PATTERN.test(tenant);
  });
}
