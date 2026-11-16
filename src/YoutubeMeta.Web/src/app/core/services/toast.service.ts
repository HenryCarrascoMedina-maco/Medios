import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface IToast {
  id: number;
  kind: ToastKind;
  message: string;
}

const MAX_VISIBLE = 5;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly toasts = signal<IToast[]>([]);

  success(message: string): void { this.show('success', message); }
  error(message: string): void { this.show('error', message, 8000); }
  info(message: string): void { this.show('info', message); }
  warning(message: string): void { this.show('warning', message, 7000); }

  dismiss(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.toasts.update(list => list.filter(t => t.id !== id));
  }

  /** Un aviso igual al que ya se ve no se repite: solo se alarga su tiempo en pantalla. */
  private show(kind: ToastKind, message: string, timeout = 5000): void {
    const existing = this.toasts().find(t => t.kind === kind && t.message === message);
    const id = existing?.id ?? this.nextId++;
    if (!existing) {
      const list = [...this.toasts(), { id, kind, message }];
      for (const dropped of list.slice(0, Math.max(0, list.length - MAX_VISIBLE))) {
        clearTimeout(this.timers.get(dropped.id));
        this.timers.delete(dropped.id);
      }
      this.toasts.set(list.slice(-MAX_VISIBLE));
    }
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => this.dismiss(id), timeout));
  }
}
