import { Currency } from '../core/models/money.model';
import { Product } from '../core/models/product.model';
import { RateSnapshot } from '../core/models/rate.model';
import { round2 } from './money';

export interface CartLine {
  product: Product;
  quantity: number;
  discountPercent: number;
  lot: string | null;
}

export interface CartTotals {
  subtotalUSD: number;
  discountUSD: number;
  taxableBaseUSD: number;
  ivaUSD: number;
  totalUSD: number;
  total: number;
  currency: Currency;
  rate: RateSnapshot | null;
}

/**
 * Estimación en cliente con las mismas reglas de business_rules.md §3.3.
 * El servidor recalcula y persiste los importes reales; aquí solo se muestra
 * el total esperado mientras el cajero arma la venta.
 */
export function calculateCart(lines: CartLine[], currency: Currency, rate: RateSnapshot | null): CartTotals {
  let subtotalUSD = 0;
  let discountUSD = 0;
  let taxableBaseUSD = 0;
  let ivaUSD = 0;
  let totalUSD = 0;

  for (const line of lines) {
    const unitPrice = Number(line.product.priceUSD) || 0;
    const gross = round2(unitPrice * line.quantity);
    const discount = round2(gross * (line.discountPercent / 100));
    const taxRate = Number(line.product.pricing?.tax?.rate) || 0;
    const priceIncludesTax = Boolean(line.product.pricing?.priceIncludesTax);

    let base: number;
    let tax: number;
    let lineTotal: number;

    if (priceIncludesTax) {
      lineTotal = round2(gross - discount);
      base = round2(lineTotal / (1 + taxRate));
      tax = round2(lineTotal - base);
    } else {
      base = round2(gross - discount);
      tax = round2(base * taxRate);
      lineTotal = round2(base + tax);
    }

    subtotalUSD = round2(subtotalUSD + gross);
    discountUSD = round2(discountUSD + discount);
    taxableBaseUSD = round2(taxableBaseUSD + base);
    ivaUSD = round2(ivaUSD + tax);
    totalUSD = round2(totalUSD + lineTotal);
  }

  const rateValue = currency === 'VES' ? Number(rate?.value) || 0 : 0;
  const total = currency === 'VES' ? round2(totalUSD * rateValue) : totalUSD;

  return {
    subtotalUSD,
    discountUSD,
    taxableBaseUSD,
    ivaUSD,
    totalUSD,
    total,
    currency,
    rate,
  };
}
