import mongoose from 'mongoose';

const idempotencySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    payloadHash: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'COMPLETED', 'FAILED'], default: 'PENDING' },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
    error: { type: String, default: null }
  },
  { timestamps: true, versionKey: false }
);

export default mongoose.model('IdempotencyRecord', idempotencySchema);
