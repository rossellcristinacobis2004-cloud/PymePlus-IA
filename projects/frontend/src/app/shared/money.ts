import { Currency } from '../core/models/money.model';

/** Redondeo final a 2 decimales, compatible con el criterio HALF_UP del backend. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Siempre muestra símbolo y código de moneda, con separadores es-VE. */
export function formatMoney(amount: number, currency: Currency): string {
  const formatted = new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);

  return currency === 'USD' ? `$${formatted} USD` : `Bs. ${formatted} VES`;
}
