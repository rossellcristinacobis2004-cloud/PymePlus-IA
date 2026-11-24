import { calculateCart } from './cart';
import { Product } from '../core/models/product.model';
import { RateSnapshot } from '../core/models/rate.model';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod_1',
    sku: 'BOD-1',
    barcode: null,
    name: 'Aceite vegetal 1 L',
    description: '',
    category: 'Abarrotes',
    priceUSD: 6.5,
    stockCurrent: 10,
    stockMinimum: 2,
    isActive: true,
    pricing: {
      priceIncludesTax: false,
      tax: { type: 'IVA_GENERAL', rate: 0.16 },
      mode: 'AUTO_BCV',
      price: {
        USD: { amount: 6.5, currency: 'USD', rateUsed: null },
        VES: { amount: 234, currency: 'VES', rateUsed: null },
      },
    },
    stock: { available: 10, reserved: 0, minimum: 2, unit: 'UN', status: 'NORMAL' },
    batches: [],
    ...overrides,
  };
}

const rate: RateSnapshot = {
  value: 36,
  source: 'BCV',
  date: '2026-11-24',
  capturedAt: '2026-11-24T09:00:00-04:00',
  isFallback: false,
  status: 'ACTIVE',
};

describe('calculateCart', () => {
  it('calcula IVA por línea con descuento previo (6,50 × 2 con 10 %)', () => {
    const totals = calculateCart([{ product: product(), quantity: 2, discountPercent: 10, lot: null }], 'USD', rate);

    expect(totals.subtotalUSD).toBe(13);
    expect(totals.discountUSD).toBe(1.3);
    expect(totals.taxableBaseUSD).toBe(11.7);
    expect(totals.ivaUSD).toBe(1.87);
    expect(totals.totalUSD).toBe(13.57);
  });

  it('convierte el total a VES con la tasa vigente', () => {
    const totals = calculateCart([{ product: product(), quantity: 2, discountPercent: 10, lot: null }], 'VES', rate);

    expect(totals.total).toBe(488.52);
    expect(totals.rate?.value).toBe(36);
  });

  it('descuenta el IVA cuando el precio ya lo incluye', () => {
    const withTax = product({ pricing: { ...product().pricing, priceIncludesTax: true } });
    const totals = calculateCart([{ product: withTax, quantity: 2, discountPercent: 0, lot: null }], 'USD', rate);

    expect(totals.totalUSD).toBe(13);
    expect(totals.taxableBaseUSD).toBe(11.21);
    expect(totals.ivaUSD).toBe(1.79);
  });
});
