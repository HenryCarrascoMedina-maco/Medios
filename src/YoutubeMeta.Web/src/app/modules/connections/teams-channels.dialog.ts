import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ConnectionHttp } from '@core/http/api.http';
import { IAccountSaveResult, ITeamsChannel, ITeamsChannelTree } from '@core/models/api.models';
import { ToastService } from '@core/services/toast.service';
import { apiError } from '@core/utils/format';
import { IconComponent } from '@shared/ui/icon.component';
import { ModalComponent } from '@shared/ui/modal.component';
import { SaveResultsComponent } from '@shared/ui/save-results.component';
import { toggled } from '@core/utils/selection';

/** Clave de un canal en la selección: «teamId/channelId» (igual que el externalId de la conexión). */
export const channelKey = (teamId: string, channelId: string) => `${teamId}/${channelId}`;

/**
 * Tras iniciar sesión en Microsoft (?teamsAccount=pick&pick=…): árbol de equipos y canales para
 * marcar en cuáles se publica. Los ya conectados salen marcados y bloqueados; los privados avisan.
 */
@Component({
  selector: 'ym-teams-channels',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ModalComponent, IconComponent, SaveResultsComponent],
  template: `
    <ym-modal #modal title="Elige los canales de Teams" [width]="600" [dirty]="selected().size > 0 && !saved()" (closed)="closed.emit()">
      <ym-icon modal-icon name="teams" [size]="20" class="text-teams" />
      @let t = tree();
      @if (error()) {
        <div class="notice notice-error" role="alert">{{ error() }} <a routerLink="/guides/teams" fragment="faqs" (click)="closed.emit()">Ver la guía</a></div>
      } @else if (t) {
        <p class="text-sm">Cuenta de trabajo: <b>{{ t.account.name }}</b> <span class="muted">({{ t.account.email }})</span></p>
        <p class="text-xs muted">Marca los canales donde podrás publicar. Cada canal será una cuenta más, con su firma y sus resultados.</p>
        @for (team of t.teams; track team.id) {
          <fieldset class="rounded-xl border border-line p-3">
            <legend class="px-1 text-sm font-semibold">{{ team.name }}</legend>
            <div class="grid gap-1">
              @for (c of team.channels; track c.id) {
                @let key = keyOf(team.id, c.id);
                <label class="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-hover" [class.opacity-70]="c.connected">
                  <input type="checkbox" [checked]="c.connected || selected().has(key)" [disabled]="c.connected" (change)="toggle(key)" [attr.aria-label]="team.name + ' › ' + c.name" />
                  <span class="muted">#</span> <span class="flex-1">{{ c.name }}</span>
                  @if (c.connected) { <span class="text-[11px] muted">ya conectado</span> }
                  @else if (hint(c)) { <span class="text-[11px] text-amber-600 dark:text-amber-400">{{ hint(c) }}</span> }
                </label>
              }
            </div>
          </fieldset>
        } @empty {
          <p class="text-sm muted">Esta cuenta no pertenece a ningún equipo.</p>
        }
        @if (results(); as list) { <ym-save-results [results]="list" /> }
      } @else {
        <p class="text-sm muted" role="status">Leyendo tus equipos y canales…</p>
      }
      <ng-container modal-footer>
        <button type="button" class="btn" (click)="modal.requestClose()">Cerrar</button>
        <button type="button" class="btn btn-teams" [disabled]="selected().size === 0 || busy()" (click)="save()">
          {{ busy() ? 'Conectando…' : 'Conectar ' + selected().size }}
        </button>
      </ng-container>
    </ym-modal>
  `
})
export class TeamsChannelsDialog implements OnInit {
  private readonly http = inject(ConnectionHttp);
  private readonly toast = inject(ToastService);

  /** Código de un solo uso que devuelve el inicio de sesión (vale 10 minutos). */
  readonly pick = input.required<string>();
  readonly closed = output<void>();
  readonly connected = output<void>();

  protected readonly tree = signal<ITeamsChannelTree | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly results = signal<IAccountSaveResult[] | null>(null);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly keyOf = channelKey;

  ngOnInit(): void {
    firstValueFrom(this.http.teamsChannels(this.pick()))
      .then(tree => this.tree.set(tree))
      .catch(error => this.error.set(apiError(error, 'El enlace de conexión caducó (10 minutos). Vuelve a pulsar «Conectar Teams».')));
  }

  protected hint(channel: ITeamsChannel): string | null {
    if (channel.membershipType === 'private') return 'privado · necesitas ser miembro';
    if (channel.membershipType === 'shared') return 'compartido';
    return null;
  }

  protected toggle(key: string): void {
    this.selected.set(toggled(this.selected(), key));
  }

  protected async save(): Promise<void> {
    if (!this.selected().size || this.busy()) return;
    this.busy.set(true);
    try {
      const channels = [...this.selected()].map(key => {
        const [teamId, channelId] = key.split('/');
        return { teamId, channelId };
      });
      const results = await firstValueFrom(this.http.teamsSave(this.pick(), channels));
      const ok = results.filter(r => !r.error).length;
      this.toast.success(`${ok} ${ok === 1 ? 'canal conectado' : 'canales conectados'}.`);
      this.saved.set(true);
      this.connected.emit();
      if (results.some(r => r.error)) this.results.set(results);
      else this.closed.emit();
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudieron conectar los canales.'));
    } finally {
      this.busy.set(false);
    }
  }
}
