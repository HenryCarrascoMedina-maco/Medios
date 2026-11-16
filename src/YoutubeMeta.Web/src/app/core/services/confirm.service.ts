import { Injectable, signal } from '@angular/core';

export interface IConfirmRequest {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}

interface IPendingConfirm extends IConfirmRequest {
  resolve: (accepted: boolean) => void;
}

/** Diálogo de confirmación único de la app (lo pinta el shell). */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly pending = signal<IPendingConfirm | null>(null);

  ask(request: IConfirmRequest): Promise<boolean> {
    this.pending()?.resolve(false);
    return new Promise(resolve => this.pending.set({ ...request, resolve }));
  }

  close(accepted: boolean): void {
    this.pending()?.resolve(accepted);
    this.pending.set(null);
  }
}
