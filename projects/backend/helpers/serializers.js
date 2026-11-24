import { money, round2, toVes } from './money.js';

export function serializeProduct(product, rate) {
  const plain = typeof product.toObject === 'function' ? product.toObject() : product;
  const snapshot = rate
    ? {
        value: rate.value,
        source: rate.source || 'BCV',
        date: rate.date,
        capturedAt: rate.capturedAt,
        isFallback: Boolean(rate.isFallback)
      }
    : null;

  return {
    id: String(plain._id),
    sku: plain.sku,
    barcode: plain.barcode || null,
    name: plain.name,
    description: plain.description || '',
    category: plain.category,
    pricing: {
      baseCurrency: 'USD',
      priceIncludesTax: plain.pricing.priceIncludesTax,
      tax: { type: plain.pricing.tax, rate: 0.16 },
      cost: money(plain.pricing.costUSD, 'USD'),
      price: {
        USD: money(plain.pricing.priceUSD, 'USD'),
        VES: money(toVes(plain.pricing.priceUSD, rate?.value || 0), 'VES', snapshot)
      },
      mode: plain.pricing.mode,
      overriddenAt: plain.pricing.overriddenAt
    },
    stock: {
      available: round2(plain.stock.available),
      reserved: round2(plain.stock.reserved),
      minimum: round2(plain.stock.minimum),
      unit: plain.stock.unit,
      status: plain.stock.status
    },
    batches: (plain.batches || []).map((batch) => ({
      lot: batch.lot,
      quantity: batch.quantity,
      manufacturingDate: batch.manufacturingDate,
      expirationDate: batch.expirationDate
    })),
    flags: plain.flags,
    audit: plain.audit,
    timestamps: { createdAt: plain.createdAt, updatedAt: plain.updatedAt }
  };
}

export function serializeSale(sale) {
  const plain = typeof sale.toObject === 'function' ? sale.toObject() : sale;

  return {
    id: String(plain._id),
    number: plain.number,
    status: plain.status,
    customer: plain.customerSnapshot,
    items: plain.items,
    totals: plain.totals,
    exchangeSnapshot: plain.exchangeSnapshot,
    payment: plain.payment,
    invoice: plain.invoice,
    audit: plain.audit,
    timestamps: { createdAt: plain.createdAt, updatedAt: plain.updatedAt }
  };
}
