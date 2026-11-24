import mongoose from 'mongoose';

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

const saleSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    status: { type: String, enum: ['COMPLETED', 'VOID'], default: 'COMPLETED' },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
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
      voidReason: String
    }
  },
  { timestamps: true, versionKey: false }
);

saleSchema.index({ 'audit.createdAt': -1 });
saleSchema.index({ customerId: 1, 'audit.createdAt': -1 });

export default mongoose.model('Sale', saleSchema);
