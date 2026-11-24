import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message: string;
  suggestion: string | null;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly toastSignal = signal<Toast[]>([]);
  private sequence = 0;

  readonly toasts = this.toastSignal.asReadonly();

  success(message: string, title = 'Listo'): void {
    this.show('success', title, message, null);
  }

  info(message: string, title = 'Información'): void {
    this.show('info', title, message, null);
  }

  warning(message: string, suggestion: string | null = null, title = 'Atención'): void {
    this.show('warning', title, message, suggestion);
  }

  error(message: string, suggestion: string | null = null, title = 'No se pudo completar'): void {
    this.show('error', title, message, suggestion);
  }

  dismiss(id: number): void {
    this.toastSignal.update((items) => items.filter((item) => item.id !== id));
  }

  private show(kind: ToastKind, title: string, message: string, suggestion: string | null): void {
    const id = ++this.sequence;
    this.toastSignal.update((items) => [
      ...items.slice(-4),
      { id, kind, title, message, suggestion },
    ]);

    setTimeout(() => this.dismiss(id), 7000);
  }
}
