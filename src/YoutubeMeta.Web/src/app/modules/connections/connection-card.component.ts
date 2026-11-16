import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CONNECTION_STATUS_META, PLATFORM_META } from '@core/constants/status.constants';
import { IConnection } from '@core/models/api.models';
import { TELEGRAM_CLOUD_MAX_MB } from '@core/utils/publication-rules';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { ChipComponent } from '@shared/ui/chip.component';
import { IconComponent } from '@shared/ui/icon.component';
import { TokenExpiryChipComponent } from '@shared/ui/token-expiry-chip.component';

/** Una cuenta conectada con sus acciones. Las peticiones las hace la página; aquí solo se emiten. */
@Component({
  selector: 'ym-connection-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, AccountAvatarComponent, ChipComponent, IconComponent, TokenExpiryChipComponent],
  host: { class: 'mb-2 block rounded-xl border border-line p-3' },
  template: `
    @let a = account();
    <div class="flex items-center gap-3">
      <ym-account-avatar [platform]="a.platform" [name]="a.alias ?? a.displayName" [url]="a.avatarUrl" [size]="40" />
      <div class="min-w-0 flex-1">
        @if (editing()) {
          <div class="flex gap-1.5">
            <input class="input !py-1 text-sm" [value]="aliasDraft()" (input)="aliasDraft.set($any($event.target).value)" maxlength="100" autofocus
                   placeholder="Nombre corto (vacío = el original)" aria-label="Nombre corto" (keydown.enter)="saveAlias()" (keydown.escape)="editing.set(false)" />
            <button type="button" class="btn btn-primary btn-sm" (click)="saveAlias()">Guardar</button>
          </div>
        } @else {
          <div class="flex items-center gap-1 truncate font-semibold">
            @if (a.isDefault) { <ym-icon name="star" [size]="13" class="text-amber-500" label="Viene marcada al publicar" /> }
            {{ a.alias ?? a.displayName }}
            @if (a.alias) { <span class="text-xs font-normal muted">({{ a.displayName }})</span> }
          </div>
        }
        <div class="truncate text-xs muted">
          {{ a.accountHint ?? a.externalId }}
          @if (a.credentialName) { · bot {{ a.credentialName }} · hasta {{ a.uploadLimitMb ?? telegramMaxMb }} MB }
          @if (a.tokenExpiresAt && a.platform !== 'TIKTOK') { · {{ meta().manualRenewal ? 'acceso' : 'token' }} hasta {{ a.tokenExpiresAt | date: 'dd/MM/yyyy' }} }
        </div>
        <div class="text-[11px] muted">Conectada por {{ a.connectedBy }} el {{ a.connectedAt | date: 'dd/MM/yyyy HH:mm' }}</div>
      </div>
      <div class="flex flex-col items-end gap-1">
        <ym-chip [tone]="status().tone">{{ status().label }}</ym-chip>
        @if (meta().manualRenewal) { <ym-token-expiry-chip [expiresAt]="a.tokenExpiresAt" /> }
      </div>
    </div>

    @if (a.statusCode === 'NEEDS_RECONNECT') {
      <div class="notice notice-error mt-2">{{ a.statusMessage ?? 'La plataforma rechazó el acceso.' }} Lo pendiente continúa al reconectar esta misma cuenta.</div>
    }
    @if (a.lastTestAt) {
      <p class="mt-2 text-xs" [class]="a.lastTestOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
        Última prueba {{ a.lastTestAt | date: 'dd/MM HH:mm' }}: {{ a.lastTestMessage }}
      </p>
    }

    @if (editingSignature()) {
      <div class="mt-2 grid gap-1.5">
        <label class="label !mb-0" [for]="'sig-' + a.id">Firma <small>se usa con &#123;firma_cuenta&#125; en las plantillas</small></label>
        <textarea [id]="'sig-' + a.id" class="input min-h-16 text-sm" maxlength="1000" autofocus [value]="signatureDraft()" (input)="signatureDraft.set($any($event.target).value)"
                  (keydown.escape)="editingSignature.set(false)"></textarea>
        <div class="flex gap-1.5">
          <button type="button" class="btn btn-primary btn-sm" (click)="saveSignature()">Guardar firma</button>
          <button type="button" class="btn btn-ghost btn-sm" (click)="editingSignature.set(false)">Cancelar</button>
        </div>
      </div>
    } @else if (a.signature) {
      <p class="mt-2 line-clamp-2 whitespace-pre-line rounded-md bg-field px-2 py-1 text-xs muted" title="Firma de la cuenta">{{ a.signature }}</p>
    }

    <div class="mt-2 flex flex-wrap gap-1.5">
      <button type="button" class="btn btn-sm" [disabled]="busy() !== null" (click)="test.emit()">{{ busy() === 'test-' + a.id ? 'Probando…' : 'Probar' }}</button>
      @if (!a.isDefault) { <button type="button" class="btn btn-sm" (click)="makeDefault.emit()"><ym-icon name="star" [size]="12" /> Marcar por defecto</button> }
      <button type="button" class="btn btn-sm" (click)="startAlias()"><ym-icon name="edit" [size]="12" /> Nombre corto</button>
      <button type="button" class="btn btn-sm" (click)="startSignature()"><ym-icon name="message" [size]="12" /> Firma</button>
      <button type="button" class="btn btn-sm" [class]="a.statusCode !== 'CONNECTED' ? meta().btn : ''" [disabled]="reconnectBlocked() || busy() !== null" (click)="reconnect.emit()">Reconectar</button>
      <button type="button" class="btn btn-ghost btn-sm btn-danger" (click)="disconnect.emit()">Quitar</button>
    </div>
  `
})
export class ConnectionCardComponent {
  readonly account = input.required<IConnection>();
  /** Acción en curso de la página («test-12», «meta-find»…): desactiva los botones. */
  readonly busy = input<string | null>(null);
  /** Falta configurar la plataforma: no se puede reconectar. */
  readonly reconnectBlocked = input(false);

  readonly test = output<void>();
  readonly makeDefault = output<void>();
  readonly aliasChange = output<string | null>();
  readonly signatureChange = output<string | null>();
  readonly reconnect = output<void>();
  readonly disconnect = output<void>();

  protected readonly editing = signal(false);
  protected readonly aliasDraft = signal('');
  protected readonly editingSignature = signal(false);
  protected readonly signatureDraft = signal('');
  protected readonly telegramMaxMb = TELEGRAM_CLOUD_MAX_MB;
  protected readonly meta = computed(() => PLATFORM_META[this.account().platform]);
  protected readonly status = computed(() => CONNECTION_STATUS_META[this.account().statusCode]);

  protected startAlias(): void {
    this.aliasDraft.set(this.account().alias ?? '');
    this.editing.set(true);
  }

  protected startSignature(): void {
    this.signatureDraft.set(this.account().signature ?? '');
    this.editingSignature.set(true);
  }

  protected saveSignature(): void {
    this.signatureChange.emit(this.signatureDraft().trim() || null);
    this.editingSignature.set(false);
  }

  protected saveAlias(): void {
    this.aliasChange.emit(this.aliasDraft().trim() || null);
    this.editing.set(false);
  }
}
