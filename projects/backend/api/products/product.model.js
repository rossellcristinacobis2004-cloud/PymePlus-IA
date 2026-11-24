import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema(
  {
    lot: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    manufacturingDate: { type: Date, default: null },
    expirationDate: { type: Date, default: null }
  },
  { _id: true }
);

const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true, uppercase: true },
    barcode: { type: String, unique: true, sparse: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    category: {
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
      name: { type: String, default: 'General' },
      defaultTax: { type: String, default: 'IVA_GENERAL' }
    },
    pricing: {
      baseCurrency: { type: String, default: 'USD' },
      priceIncludesTax: { type: Boolean, default: false },
      tax: { type: String, default: 'IVA_GENERAL' },
      costUSD: { type: Number, default: 0, min: 0 },
      priceUSD: { type: Number, required: true, min: 0 },
      mode: {
        type: String,
        enum: ['AUTO_BCV', 'MANUAL_VES', 'PROMOTION'],
        default: 'AUTO_BCV'
      },
      overriddenAt: { type: Date, default: null }
    },
    stock: {
      available: { type: Number, default: 0, min: 0 },
      reserved: { type: Number, default: 0, min: 0 },
      minimum: { type: Number, default: 0, min: 0 },
      maximum: { type: Number, default: null },
      unit: { type: String, default: 'UN' }
    },
    batches: { type: [batchSchema], default: [] },
    flags: {
      active: { type: Boolean, default: true },
      trackExpiration: { type: Boolean, default: true },
      blockExpiredSale: { type: Boolean, default: true }
    },
    audit: {
      createdBy: { type: String, default: null },
      updatedBy: { type: String, default: null }
    }
  },
  { timestamps: true, versionKey: '__v' }
);

productSchema.virtual('stock.status').get(function stockStatus() {
  const { available, minimum, maximum } = this.stock;
  if (available === 0) return 'OUT_OF_STOCK';
  if (available <= minimum) return 'LOW';
  if (maximum !== null && available > maximum) return 'OVERSTOCK';
  return 'NORMAL';
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

productSchema.index({ name: 'text', sku: 'text', barcode: 'text' });

export default mongoose.model('Product', productSchema);
