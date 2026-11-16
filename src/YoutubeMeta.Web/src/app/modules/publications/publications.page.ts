import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime, filter, firstValueFrom, merge, skip } from 'rxjs';
import { ConnectionHttp, PublicationHttp } from '@core/http/api.http';
import { PLATFORM_META } from '@core/constants/status.constants';
import { RulesService } from '@core/services/rules.service';
import { IConnection, IPublication, IPublicationQuery, Platform } from '@core/models/api.models';
import { EntityHubService } from '@core/services/entity-hub.service';
import { PublicationActionsService } from '@core/services/publication-actions.service';
import { ToastService } from '@core/services/toast.service';
import { dayRangeToIso } from '@core/utils/dates';
import { datedFileName, downloadBlob } from '@core/utils/download';
import { apiError } from '@core/utils/format';
import { createLoader } from '@core/utils/loader';
import { canCancel, canRetry, withProgress } from '@core/utils/publication-actions';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { AsyncStateComponent } from '@shared/ui/async-state.component';
import { BulkBarComponent } from '@shared/ui/bulk-bar.component';
import { FilterChipsComponent, IFilterOption } from '@shared/ui/filter-chips.component';
import { IconComponent } from '@shared/ui/icon.component';
import { PublicationMetricsComponent } from '@shared/ui/publication-metrics.component';
import { PublicationNotesComponent } from '@shared/ui/publication-notes.component';
import { PublicationProgressComponent } from '@shared/ui/publication-progress.component';
import { PublicationResolveComponent } from '@shared/ui/publication-resolve.component';
import { PostKindBadgeComponent } from '@shared/ui/post-kind-badge.component';
import { PublishDialog } from '@shared/publish/publish.dialog';
import { createPublishLauncher } from '@shared/publish/publish-launcher';
import { StatusChipComponent } from '@shared/ui/status-chip.component';
import { PublicationRowActionsComponent } from './publication-row-actions.component';
import { toggled } from '@core/utils/selection';

type Group = '' | 'ACTIVE' | 'DONE' | 'ERROR' | 'WAITING';

@Component({
  selector: 'ym-publications-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, RouterLink, PublicationMetricsComponent, FilterChipsComponent, StatusChipComponent, AccountAvatarComponent, AsyncStateComponent, IconComponent,
    PublicationNotesComponent, PublicationProgressComponent, PublicationRowActionsComponent, PublicationResolveComponent, BulkBarComponent,
    PostKindBadgeComponent, PublishDialog
  ],
  templateUrl: './publications.page.html'
})
export class PublicationsPage implements OnInit {
  private readonly http = inject(PublicationHttp);
  private readonly connections = inject(ConnectionHttp);
  private readonly hub = inject(EntityHubService);
  private readonly actions = inject(PublicationActionsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly publish = createPublishLauncher();

  protected readonly groups: IFilterOption<Group>[] = [
    { value: '', label: 'Todas' },
    { value: 'ACTIVE', label: 'Activas' },
    { value: 'DONE', label: 'Publicadas' },
    { value: 'ERROR', label: 'Con error' },
    { value: 'WAITING', label: 'Esperando cuota' }
  ];
  protected readonly meta = PLATFORM_META;
  protected readonly platforms = inject(RulesService).publishPlatforms;

  protected readonly group = signal<Group>('');
  protected readonly platform = signal<Platform | ''>('');
  protected readonly connectionId = signal<number | null>(null);
  protected readonly query = signal('');
  private readonly query$ = toObservable(this.query);
  protected readonly dateFrom = signal('');
  protected readonly dateTo = signal('');
  protected readonly exporting = signal(false);
  protected readonly accounts = signal<IConnection[]>([]);
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  protected readonly busy = signal(false);

  /** Cuentas del filtro: las de la plataforma elegida (incluidas las ya quitadas, por su historial). */
  protected readonly accountOptions = computed(() => this.accounts().filter(a => !this.platform() || a.platform === this.platform()));

  /** Filtros que van al servidor (también los usa «Exportar CSV»). */
  private readonly filters = computed<IPublicationQuery>(() => ({
    group: this.group() || undefined,
    platform: this.platform(),
    connectionId: this.connectionId(),
    searchTerm: this.query().trim() || undefined,
    ...dayRangeToIso(this.dateFrom(), this.dateTo())
  }));

  /** Cambiar un filtro cancela la petición anterior. */
  protected readonly items = createLoader(() => this.http.list(this.filters()), { errorMessage: 'No se pudieron cargar las publicaciones.' });
  protected readonly visible = computed(() => this.items.value() ?? []);

  protected readonly selectedItems = computed(() => this.visible().filter(p => this.selected().has(p.id)));
  protected readonly allSelected = computed(() => this.visible().length > 0 && this.selectedItems().length === this.visible().length);
  protected readonly retryable = computed(() => this.selectedItems().filter(canRetry).length);
  protected readonly cancellable = computed(() => this.selectedItems().filter(canCancel).length);

  ngOnInit(): void {
    this.hub.publishUpdates()
      .pipe(filter(u => !u.isFinal), takeUntilDestroyed(this.destroyRef))
      .subscribe(u => this.items.value.update(list => list && withProgress(list, u)));

    merge(this.hub.publishUpdates().pipe(filter(u => u.isFinal)), this.hub.reconnected$)
      .pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.items.reload());

    this.query$
      .pipe(skip(1), debounceTime(350), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refilter());

    this.items.reload();
    void firstValueFrom(this.connections.status())
      .then(s => this.accounts.set([...s.accounts, ...s.history]))
      .catch(() => undefined);
  }

  protected setGroup(group: Group): void {
    this.group.set(group);
    this.refilter();
  }

  protected setPlatform(platform: Platform | ''): void {
    this.platform.set(platform);
    if (this.connectionId() && !this.accountOptions().some(a => a.id === this.connectionId())) this.connectionId.set(null);
    this.refilter();
  }

  protected setAccount(value: string): void {
    this.connectionId.set(value ? Number(value) : null);
    this.refilter();
  }

  protected setDate(which: 'from' | 'to', value: string): void {
    (which === 'from' ? this.dateFrom : this.dateTo).set(value);
    this.refilter();
  }

  protected async exportCsv(): Promise<void> {
    this.exporting.set(true);
    try {
      downloadBlob(await firstValueFrom(this.http.exportCsv(this.filters())), datedFileName('publicaciones', 'csv'));
    } catch (error) {
      this.toast.error(apiError(error, 'No se pudo exportar.'));
    } finally {
      this.exporting.set(false);
    }
  }

  protected isSelected(id: number): boolean {
    return this.selected().has(id);
  }

  protected toggleSelect(id: number): void {
    this.selected.set(toggled(this.selected(), id));
  }

  protected toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.visible().map(p => p.id)));
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected async retry(p: IPublication): Promise<void> {
    if (await this.actions.retry(p)) this.items.reload();
  }

  protected async retryComment(p: IPublication): Promise<void> {
    if (await this.actions.retryComment(p)) this.items.reload();
  }

  protected newPost(): void {
    void this.publish.open([], null, { asPost: true });
  }

  protected onPublished(): void {
    this.publish.close();
    this.items.reload();
  }

  protected async cancel(p: IPublication): Promise<void> {
    if (await this.actions.cancel(p)) this.items.reload();
  }

  protected async bulk(action: 'retry' | 'cancel'): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const list = this.selectedItems();
      const changed = action === 'retry' ? await this.actions.retryMany(list) : await this.actions.cancelMany(list);
      if (changed) {
        this.clearSelection();
        this.items.reload();
      }
    } finally {
      this.busy.set(false);
    }
  }

  private refilter(): void {
    this.clearSelection();
    this.items.reset();
  }
}
