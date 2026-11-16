import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmService } from './core/services/confirm.service';
import { ModalComponent } from './shared/ui/modal.component';
import { ToastHostComponent } from './shared/ui/toast-host.component';

@Component({
  selector: 'ym-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ModalComponent, ToastHostComponent],
  template: `
    <router-outlet />
    <ym-toast-host />

    @if (confirm.pending(); as request) {
      <ym-modal [title]="request.title" [width]="460" (closed)="confirm.close(false)">
        <p class="text-sm">{{ request.message }}</p>
        <ng-container modal-footer>
          <button type="button" class="btn" (click)="confirm.close(false)">Cancelar</button>
          <button type="button" class="btn" [class]="request.danger ? 'btn-danger-solid' : 'btn-primary'" (click)="confirm.close(true)">{{ request.confirmText ?? 'Aceptar' }}</button>
        </ng-container>
      </ym-modal>
    }
  `
})
export class AppComponent {
  protected readonly confirm = inject(ConfirmService);
}
