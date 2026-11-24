import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    documentType: { type: String, enum: ['RIF', 'CI', 'PASSPORT'], required: true },
    documentNumber: { type: String, required: true, uppercase: true, trim: true },
    email: { type: String, lowercase: true, trim: true, default: null },
    phone: { type: String, trim: true, default: null },
    address: {
      street: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      country: { type: String, default: 'VE' }
    },
    credit: {
      enabled: { type: Boolean, default: false },
      limitUSD: { type: Number, default: 0, min: 0 },
      balanceUSD: { type: Number, default: 0, min: 0 },
      days: { type: Number, default: 0 }
    },
    isTaxExempt: { type: Boolean, default: false },
    exemptionCertificate: { type: String, default: null },
    active: { type: Boolean, default: true }
  },
  { timestamps: true, versionKey: false }
);

customerSchema.index({ documentType: 1, documentNumber: 1 }, { unique: true });
customerSchema.index({ name: 'text', documentNumber: 'text' });

export default mongoose.model('Customer', customerSchema);
