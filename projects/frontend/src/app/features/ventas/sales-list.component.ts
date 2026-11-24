import { Component, inject, signal } from '@angular/core';

import { toApiError } from '../../core/errors/api-error';
import { Sale } from '../../core/models/sale.model';
import { ApiService } from '../../core/services/api.service';
import { formatMoney } from '../../shared/money';

export interface SaleRow extends Sale {
  customerName?: string;
  customerRUT?: string;
}

export function formatSaleDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

@Component({
  selector: 'app-sales-list',
  standalone: true,
  templateUrl: './sales-list.component.html',
  styleUrl: './sales-list.component.scss',
})
export class SalesListComponent {
  private readonly api = inject(ApiService);

  readonly formatMoney = formatMoney;
  readonly formatSaleDate = formatSaleDate;

  readonly sales = signal<SaleRow[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.api.get<SaleRow[]>('/sales?limit=50').subscribe({
      next: (sales) => this.sales.set(sales),
      error: (error: unknown) => {
        const apiError = toApiError(error);
        this.errorMessage.set(apiError.userMessage);
        this.loading.set(false);
      },
      complete: () => this.loading.set(false),
    });
  }

  downloadInvoice(sale: SaleRow): void {
    if (!sale.invoice?.pdfUrl) return;

    this.api.download(sale.invoice.pdfUrl).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${sale.invoiceNumber}.pdf`;
        anchor.click();
        URL.revokeObjectURL(url);
      },
      error: (error: unknown) => {
        const apiError = toApiError(error);
        this.errorMessage.set(apiError.userMessage);
      },
    });
  }
}
