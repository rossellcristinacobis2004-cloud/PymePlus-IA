import { money, round2, toVes } from './money.js';
import { IVA_RATES } from './tax.js';
import { toDisplayPaymentMethod } from './payment.js';

function rateSnapshot(rate) {
  if (!rate) return null;
  return {
    value: rate.value,
    source: rate.source || 'BCV',
    date: rate.date,
    capturedAt: rate.capturedAt,
    isFallback: Boolean(rate.isFallback)
  };
}

/** Respeta el modo de precio: AUTO_BCV, MANUAL_VES o PROMOTION. */
function resolveVesPrice(plain, rate, snapshot) {
  const pricing = plain.pricing || {};
  const mode = pricing.mode || 'AUTO_BCV';

  if (mode === 'MANUAL_VES' && pricing.manualPriceVES !== null && pricing.manualPriceVES !== undefined) {
    return { ...money(round2(pricing.manualPriceVES), 'VES', null), source: 'MANUAL' };
  }

  if (mode === 'PROMOTION') {
    const baseUSD = Number(pricing.promotionPriceUSD ?? pricing.priceUSD ?? 0);
    return { ...money(toVes(baseUSD, rate?.value || 0), 'VES', snapshot), isPromotion: true };
  }

  return money(toVes(pricing.priceUSD || 0, rate?.value || 0), 'VES', snapshot);
}

export function serializeProduct(product, rate) {
  const plain = typeof product.toObject === 'function' ? product.toObject() : product;
  const snapshot = rateSnapshot(rate);
  const pricing = plain.pricing || {};
  const stock = plain.stock || {};
  const taxType = pricing.tax || 'IVA_GENERAL';

  return {
    id: String(plain._id),
    sku: plain.sku,
    barcode: plain.barcode || null,
    name: plain.name,
    description: plain.description || '',
    category: typeof plain.category === 'string' ? plain.category : plain.category?.name || 'General',
    categoryId: plain.categoryId || plain.category?.id || null,
    imageUrl: plain.imageUrl || null,
    costUSD: round2(pricing.costUSD || 0),
    priceUSD: round2(pricing.priceUSD || 0),
    stockCurrent: round2(stock.available || 0),
    stockMinimum: round2(stock.minimum || 0),
    isActive: plain.flags?.active !== false,
    pricing: {
      baseCurrency: 'USD',
      priceIncludesTax: Boolean(pricing.priceIncludesTax),
      tax: { type: taxType, rate: IVA_RATES[taxType] ?? IVA_RATES.IVA_GENERAL },
      cost: money(pricing.costUSD || 0, 'USD'),
      price: {
        USD: money(pricing.priceUSD || 0, 'USD'),
        VES: resolveVesPrice(plain, rate, snapshot)
      },
      manualPriceVES: pricing.manualPriceVES ?? null,
      promotionPriceUSD: pricing.promotionPriceUSD ?? null,
      mode: pricing.mode || 'AUTO_BCV',
      overriddenAt: pricing.overriddenAt || null
    },
    stock: {
      available: round2(stock.available || 0),
      reserved: round2(stock.reserved || 0),
      minimum: round2(stock.minimum || 0),
      unit: stock.unit || 'UN',
      status: stock.status
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
  const items = (plain.items || []).map((item) => ({
    ...item,
    priceUSD: round2(item.unitPrice?.amount ?? item.priceUSD ?? 0),
    subtotalUSD: round2(item.subtotal?.amount ?? item.subtotalUSD ?? 0)
  }));

  return {
    id: String(plain._id),
    invoiceNumber: plain.invoice?.number || plain.invoiceNumber || plain.number,
    number: plain.number,
    status: plain.status,
    customer: plain.customerSnapshot,
    customerName: plain.customerName || plain.customerSnapshot?.name || null,
    customerRUT: plain.customerRUT || plain.customerSnapshot?.documentNumber || null,
    items,
    totals: plain.totals,
    totalUSD: round2(plain.totals?.total?.amount ?? 0),
    totalVES: round2(plain.totals?.totalInVES?.amount ?? 0),
    exchangeRate: plain.exchangeSnapshot?.value ?? null,
    exchangeSnapshot: plain.exchangeSnapshot,
    paymentMethod: plain.paymentMethod || toDisplayPaymentMethod(plain.payment?.method) || null,
    payment: plain.payment,
    invoice: plain.invoice,
    audit: plain.audit,
    createdAt: plain.audit?.createdAt || plain.createdAt,
    timestamps: { createdAt: plain.createdAt, updatedAt: plain.updatedAt }
  };
}
