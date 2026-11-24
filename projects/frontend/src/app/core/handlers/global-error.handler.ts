import { ErrorHandler, Injectable, inject } from '@angular/core';

import { ApiError } from '../errors/api-error';
import { ToastService } from '../services/toast.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly toasts = inject(ToastService);

  handleError(error: unknown): void {
    if (error instanceof ApiError) {
      this.toasts.error(error.userMessage || error.message, error.suggestion);
      return;
    }

    console.error('[PymePlus IA] Error no controlado:', error);
    this.toasts.error(
      'Ocurrió un problema inesperado. Inténtalo de nuevo.',
      'Si continúa, recarga la aplicación.',
    );
  }
}
