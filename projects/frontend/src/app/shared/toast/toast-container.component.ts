import { Component, inject } from '@angular/core';

import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  template: `
    <div class="toast-container position-fixed top-0 end-0 p-3" aria-live="polite">
      @for (toast of toasts.toasts(); track toast.id) {
        <div
          class="toast show"
          [class.text-bg-success]="toast.kind === 'success'"
          [class.text-bg-danger]="toast.kind === 'error'"
          [class.text-bg-warning]="toast.kind === 'warning'"
          [class.text-bg-primary]="toast.kind === 'info'"
          role="status"
        >
          <div class="toast-header">
            <i
              class="bi me-2"
              [class.bi-check-circle]="toast.kind === 'success'"
              [class.bi-exclamation-octagon]="toast.kind === 'error'"
              [class.bi-exclamation-triangle]="toast.kind === 'warning'"
              [class.bi-info-circle]="toast.kind === 'info'"
            ></i>
            <strong class="me-auto">{{ toast.title }}</strong>
            <button
              type="button"
              class="btn-close"
              aria-label="Cerrar aviso"
              (click)="toasts.dismiss(toast.id)"
            ></button>
          </div>
          <div class="toast-body">
            <div>{{ toast.message }}</div>
            @if (toast.suggestion) {
              <div class="small mt-1 opacity-75">{{ toast.suggestion }}</div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class ToastContainerComponent {
  readonly toasts = inject(ToastService);
}
