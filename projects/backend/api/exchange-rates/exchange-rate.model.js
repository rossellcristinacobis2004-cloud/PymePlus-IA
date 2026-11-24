import mongoose from 'mongoose';

const exchangeRateSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    source: { type: String, enum: ['BCV', 'MANUAL'], default: 'BCV' },
    value: { type: Number, required: true, min: 0 },
    capturedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['ACTIVE', 'STALE', 'EXPIRED', 'PENDING_REVIEW'],
      default: 'ACTIVE'
    },
    isFallback: { type: Boolean, default: false },
    reason: { type: String, default: null },
    verifiedBy: { type: String, default: null }
  },
  { timestamps: true, versionKey: false }
);

exchangeRateSchema.index({ date: 1, source: 1 }, { unique: true });

export default mongoose.model('ExchangeRate', exchangeRateSchema);
