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
  customer?: {
    id: string;
    name: string;
    documentType: string;
    documentNumber: string;
    email?: string | null;
    phone?: string | null;
  } | null;
  customerName?: string | null;
  customerRUT?: string | null;
}
