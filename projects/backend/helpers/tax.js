import { round2 } from './money.js';

export const IVA_RATES = Object.freeze({
  IVA_GENERAL: 0.16,
  IVA_EXENTO: 0,
  IVA_EXPORTACION: 0
});

export function resolveTaxType(productTax, categoryTax = 'IVA_GENERAL') {
  const candidate = productTax || categoryTax || 'IVA_GENERAL';
  return IVA_RATES[candidate] === undefined ? 'IVA_GENERAL' : candidate;
}

/**
 * Cálculo por línea definido en business_rules.md §3.3.
 * El precio de entrada siempre está en USD (moneda base).
 */
export function calculateLine({
  unitPriceUSD,
  quantity,
  discountPercent = 0,
  taxType = 'IVA_GENERAL',
  priceIncludesTax = false
}) {
  const rate = IVA_RATES[taxType] ?? IVA_RATES.IVA_GENERAL;
  const qty = Math.max(0, Number(quantity) || 0);
  const gross = round2(Number(unitPriceUSD) * qty);
  const discount = round2(gross * (Number(discountPercent) / 100));
  const discounted = round2(gross - discount);

  let taxableBase;
  let iva;
  let total;

  if (priceIncludesTax) {
    total = discounted;
    taxableBase = round2(total / (1 + rate));
    iva = round2(total - taxableBase);
  } else {
    taxableBase = discounted;
    iva = round2(taxableBase * rate);
    total = round2(taxableBase + iva);
  }

  return {
    gross,
    discount,
    taxableBase,
    iva,
    total,
    tax: { type: taxType, rate, amountUSD: iva }
  };
}
