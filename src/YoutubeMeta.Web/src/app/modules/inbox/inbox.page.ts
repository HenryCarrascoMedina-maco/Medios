import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { InboxCountsService } from '@core/services/inbox-counts.service';
import { IconComponent } from '@shared/ui/icon.component';
import { ContactPanelComponent } from './contact-panel.component';
import { ConversationListComponent } from './conversation-list.component';
import { DEFAULT_FILTERS, InboxStore } from './inbox.store';
import { NewConversationDialog } from './new-conversation.dialog';
import { ThreadComponent } from './thread.component';

/**
 * Bandeja unificada: mensajes privados y comentarios de todas las cuentas. /inbox/:id abre una conversación (enlace
 * que se puede compartir y que abren los avisos); ?awaiting=true filtra las que esperan respuesta.
 */
@Component({
  selector: 'ym-inbox-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, ContactPanelComponent, ConversationListComponent, NewConversationDialog, ThreadComponent],
  providers: [InboxStore],
  host: { class: 'block' },
  template: `
    <div class="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 class="text-xl font-bold">Bandeja</h1>
        <p class="text-sm muted">Mensajes privados y comentarios de todas tus cuentas en un solo lugar. {{ counts.counts().awaiting }} esperando respuesta.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm btn-primary" (click)="newOpen.set(true)"><ym-icon name="plus" [size]="13" /> Nueva conversación</button>
        <a routerLink="/settings/inbox" class="btn btn-sm no-underline"><ym-icon name="sliders" [size]="13" /> Configurar la bandeja</a>
      </div>
    </div>

    @if (newOpen()) {
      <ym-new-conversation-dialog (started)="started($event)" (closed)="newOpen.set(false)" />
    }

    <div class="card grid h-[calc(100dvh-11.5rem)] min-h-[420px] overflow-hidden md:h-[calc(100dvh-9.5rem)] lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_260px]">
      <!-- En pantallas pequeñas se ve la lista o la conversación; desde lg, las dos. -->
      <ym-conversation-list class="border-line lg:flex lg:border-r" [class.hidden]="!!store.selectedId()" [initialSearch]="initialSearch" (open)="open($event)" />
      @if (store.selected(); as c) {
        <ym-thread [conversation]="c" (back)="open(null)" (details)="detailsOpen.set(!detailsOpen())" />
        <!-- La ficha es la tercera columna en xl; antes, un panel que se abre desde la cabecera. -->
        <ym-contact-panel [conversation]="c" [class]="detailsOpen() ? panelOverlay : 'hidden xl:block'" />
      } @else {
        <div class="hidden place-items-center p-6 text-center text-sm muted lg:grid xl:col-span-2">
          <div>
            <ym-icon name="inbox" [size]="36" class="mb-2 text-slate-300 dark:text-slate-600" />
            <p>Elige una conversación para leerla y responder.</p>
            <p class="mt-1 text-xs">¿No llega nada? Revisa <a routerLink="/settings/inbox">Configuración › Bandeja</a>.</p>
          </div>
        </div>
      }
    </div>
  `
})
export class InboxPage implements OnInit {
  protected readonly store = inject(InboxStore);
  protected readonly counts = inject(InboxCountsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly detailsOpen = signal(false);
  protected readonly newOpen = signal(false);
  protected readonly panelOverlay = 'fixed inset-y-0 right-0 z-40 w-72 shadow-xl xl:static xl:w-auto xl:shadow-none';
  protected initialSearch = '';

  ngOnInit(): void {
    const query = this.route.snapshot.queryParamMap;
    this.initialSearch = query.get('q') ?? '';
    if (query.get('awaiting') === 'true') this.store.setFilters({ ...DEFAULT_FILTERS, status: '', awaiting: true });
    if (this.initialSearch) this.store.setFilters({ searchTerm: this.initialSearch, status: '' });

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = Number(params.get('id'));
      this.detailsOpen.set(false);
      void this.store.select(Number.isFinite(id) && id > 0 ? id : null);
    });
  }

  /** Conversación de WhatsApp recién empezada: se abre (la lista la recibe por tiempo real). */
  protected started(id: number): void {
    this.newOpen.set(false);
    this.open(id);
  }

  protected open(id: number | null): void {
    void this.router.navigate(id == null ? ['/inbox'] : ['/inbox', id], { queryParamsHandling: 'preserve' });
  }
}
