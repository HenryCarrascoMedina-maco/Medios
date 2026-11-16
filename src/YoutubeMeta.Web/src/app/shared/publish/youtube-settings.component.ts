import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { PRIVACY_LABEL } from '@core/constants/status.constants';
import { ICategory, IPlaylist, PrivacyStatus } from '@core/models/api.models';
import { TemplateStoreService } from '@core/services/template-store.service';
import { CheckboxComponent } from '@shared/ui/checkbox.component';
import { ChoiceGroupComponent, IChoice } from '@shared/ui/choice-group.component';
import { ScheduleFieldComponent } from '@shared/ui/schedule-field.component';
import { PlatformSettingsBase } from './platform-settings.base';
import { ReqComponent } from '@shared/ui/req.component';

const YOUTUBE_PRIVACY: readonly PrivacyStatus[] = ['public', 'unlisted', 'private'];

@Component({
  selector: 'ym-youtube-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CheckboxComponent, ChoiceGroupComponent, ScheduleFieldComponent, ReqComponent],
  host: { class: 'grid gap-3' },
  template: `
    @let a = account();
    @let d = draft();
    @if (short()) { <div class="notice notice-warn">Vertical o cuadrado y de menos de 3 minutos: YouTube lo publicará como <b>Short</b>.</div> }
    @if (longVideo()) { <div class="notice notice-info">Dura más de 15 minutos: el canal debe estar verificado por teléfono.</div> }
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="label" [for]="'tags-' + a.id">Etiquetas <small>separadas por comas</small></label>
        <input [id]="'tags-' + a.id" class="input" [value]="d.tags" (input)="patch.emit({ tags: $any($event.target).value })" placeholder="grifería, baño" />
      </div>
      <div>
        <label class="label" [for]="'cat-' + a.id">Categoría <ym-req /></label>
        <select [id]="'cat-' + a.id" class="input" [value]="d.categoryId" (change)="patch.emit({ categoryId: $any($event.target).value })">
          <option value="">Selecciona…</option>
          @for (c of categories(); track c.id) { <option [value]="c.id" [selected]="c.id === d.categoryId">{{ c.title }}</option> }
        </select>
      </div>
    </div>
    <div>
      <label class="label" [for]="'pl-' + a.id">Lista de reproducción <small>opcional</small></label>
      <select [id]="'pl-' + a.id" class="input" (change)="patch.emit({ playlistId: $any($event.target).value })" [disabled]="playlists() === null">
        <option value="" [selected]="!d.playlistId">{{ playlists() === null ? 'Cargando listas…' : 'Ninguna' }}</option>
        @for (p of playlists() ?? []; track p.id) { <option [value]="p.id" [selected]="p.id === d.playlistId">{{ p.title }} ({{ p.itemCount }})</option> }
      </select>
      @if (playlistError()) { <p class="hint text-amber-600">No se pudieron leer las listas del canal. <button type="button" class="underline" (click)="loadPlaylists()">Reintentar</button></p> }
    </div>
    <div>
      <div class="label">Visibilidad @if (!d.publishAt) { <ym-req /> } @else { <small>programado: siempre Privado</small> }</div>
      <ym-choice-group ariaLabel="Visibilidad" [options]="privacyOptions()" [value]="d.publishAt ? 'private' : d.privacy" (valueChange)="patch.emit({ privacy: $event })" />
    </div>
    <div class="grid gap-3 sm:grid-cols-2">
      <ym-schedule-field [inputId]="'at-' + a.id" [value]="d.publishAt" (valueChange)="patch.emit({ publishAt: $event })">
        <p class="hint">@if (d.publishAt) { Se sube como <b>Privado</b> y YouTube lo publica a esa hora. } @else { Vacío = al terminar de procesarse. }</p>
      </ym-schedule-field>
      <ym-checkbox class="sm:mt-6" [checked]="d.notify" (checkedChange)="patch.emit({ notify: $event })">Notificar a los suscriptores</ym-checkbox>
    </div>
    <p class="hint">Al publicar aceptas los <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">Términos de YouTube</a> y la <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Política de privacidad de Google</a>.</p>
  `
})
export class YoutubeSettingsComponent extends PlatformSettingsBase {
  readonly categories = input<ICategory[]>([]);
  readonly short = input(false);
  readonly longVideo = input(false);

  private readonly store = inject(TemplateStoreService);
  /** null = cargando. Se piden al mostrar el panel de esa cuenta (y se cachean por canal). */
  protected readonly playlists = signal<IPlaylist[] | null>(null);
  protected readonly playlistError = signal(false);

  constructor() {
    super();
    effect(() => {
      this.account();
      this.loadPlaylists();
    });
  }

  protected loadPlaylists(): void {
    const id = this.account().id;
    this.playlists.set(null);
    this.playlistError.set(false);
    this.store.playlists(id)
      .then(list => this.account().id === id && this.playlists.set(list))
      .catch(() => {
        if (this.account().id !== id) return;
        this.playlists.set([]);
        this.playlistError.set(true);
      });
  }

  /** Programado = se sube privado y YouTube lo publica a esa hora: las demás opciones se desactivan. */
  protected readonly privacyOptions = computed<IChoice<PrivacyStatus>[]>(() =>
    YOUTUBE_PRIVACY.map(value => ({ value, label: PRIVACY_LABEL[value], disabled: !!this.draft().publishAt && value !== 'private' })));
}
