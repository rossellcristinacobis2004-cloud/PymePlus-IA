import { Currency, Money } from './money.model';

export interface Sale {
  id: string;
  number: string;
  status: string;
  invoiceNumber: string;
  invoice: { number: string; pdfUrl: string } | null;
  totals: {
    taxableBase: Money;
    iva: Money;
    total: Money;
    totalInVES: Money;
    paid: Money;
    change: Money;
  };
  totalUSD: number;
  totalVES: number;
  paymentMethod: string;
  createdAt: string;
  currency?: Currency;
}
