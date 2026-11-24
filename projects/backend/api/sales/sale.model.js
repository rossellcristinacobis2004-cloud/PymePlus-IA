import mongoose from 'mongoose';
import { PAYMENT_METHODS } from '../../helpers/payment.js';
import { parseCustomerRUT } from '../../helpers/validators.js';

const moneySchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    currency: { type: String, enum: ['USD', 'VES'], required: true },
    rateUsed: { type: Object, default: null }
  },
  { _id: false }
);

const saleItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: String,
    name: String,
    barcode: String,
    lot: String,
    quantity: Number,
    unit: String,
    unitPrice: moneySchema,
    discount: { type: Object, default: null },
    tax: { type: Object, default: null },
    subtotal: moneySchema,
    total: moneySchema,
    stockAfter: Number
  },
  { _id: false }
);

// Campos planos solicitados por el contrato de facturación.
saleItemSchema.virtual('priceUSD').get(function getPriceUSD() {
  return this.unitPrice?.amount ?? 0;
});
saleItemSchema.virtual('subtotalUSD').get(function getSubtotalUSD() {
  return this.subtotal?.amount ?? 0;
});

const saleSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    status: { type: String, enum: ['COMPLETED', 'VOID'], default: 'COMPLETED' },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    customerRUT: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
      validate: {
        validator(value) {
          if (!value) return true;
          try {
            parseCustomerRUT(value);
            return true;
          } catch {
            return false;
          }
        },
        message: 'customerRUT debe ser un RIF, cédula o pasaporte válido.'
      }
    },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: null },
    customerSnapshot: { type: Object, default: null },
    items: { type: [saleItemSchema], default: [] },
    totals: {
      subtotal: moneySchema,
      discount: moneySchema,
      taxableBase: moneySchema,
      iva: moneySchema,
      total: moneySchema,
      totalInVES: moneySchema,
      paid: moneySchema,
      change: moneySchema
    },
    exchangeSnapshot: { type: Object, required: true },
    payment: { type: Object, default: {} },
    invoice: { type: Object, default: null },
    audit: {
      sellerId: String,
      sellerName: String,
      idempotencyKey: String,
      createdAt: Date,
      voidedAt: Date,
      voidReason: String,
      creditBalanceAfter: Number
    }
  },
  { timestamps: true, versionKey: false }
);

saleSchema
  .virtual('invoiceNumber')
  .get(function getInvoiceNumber() {
    return this.invoice?.number || this.number;
  });

saleSchema
  .virtual('customerName')
  .get(function getCustomerName() {
    return this.customerSnapshot?.name || null;
  });

saleSchema
  .virtual('totalUSD')
  .get(function getTotalUSD() {
    return this.totals?.total?.amount ?? 0;
  });

saleSchema
  .virtual('totalVES')
  .get(function getTotalVES() {
    return this.totals?.totalInVES?.amount ?? 0;
  });

saleSchema
  .virtual('exchangeRate')
  .get(function getExchangeRate() {
    return this.exchangeSnapshot?.value ?? null;
  });

saleSchema.set('toJSON', { virtuals: true });
saleSchema.set('toObject', { virtuals: true });

saleSchema.index({ 'audit.createdAt': -1 });
saleSchema.index({ customerId: 1, 'audit.createdAt': -1 });

export default mongoose.model('Sale', saleSchema);
