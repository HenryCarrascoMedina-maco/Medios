import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, catchError, debounceTime, merge, of, startWith, switchMap } from 'rxjs';
import { InboxHttp } from '../http/api.http';
import { IInboxCounts } from '../models/api.models';
import { EntityHubService } from './entity-hub.service';

const EMPTY: IInboxCounts = { open: 0, pending: 0, closed: 0, unread: 0, awaiting: 0 };

/**
 * Contadores de la bandeja (GET /api/Inbox/Counts): el número del menú y los filtros de la bandeja. Se recalculan al
 * llegar un evento «Inbox» del hub y al reconectar; las pantallas que cambian algo piden `refresh()`.
 */
@Injectable({ providedIn: 'root' })
export class InboxCountsService {
  private readonly http = inject(InboxHttp);
  private readonly hub = inject(EntityHubService);

  readonly counts = signal<IInboxCounts>(EMPTY);

  /** Empieza a seguir los cambios mientras viva quien llama (el shell). */
  watch(destroyRef: DestroyRef): void {
    merge(this.hub.on('Inbox'), this.hub.reconnected$)
      .pipe(
        startWith(null),
        debounceTime(400),
        switchMap(() => this.fetch()),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe(counts => {
        if (counts) this.counts.set(counts);
      });
  }

  refresh(): void {
    this.fetch().subscribe(counts => {
      if (counts) this.counts.set(counts);
    });
  }

  private fetch(): Observable<IInboxCounts | null> {
    return this.http.counts().pipe(catchError(() => of(null)));
  }
}
