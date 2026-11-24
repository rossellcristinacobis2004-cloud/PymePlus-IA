import mongoose from 'mongoose';

const MOVEMENT_TYPES = ['SALE_OUT', 'SALE_VOID', 'RECEIPT', 'ADJUSTMENT', 'EXPIRED_DISPOSAL'];

const inventoryMovementSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    delta: { type: Number, required: true },
    stockBefore: { type: Number, required: true },
    stockAfter: { type: Number, required: true },
    lot: { type: String, default: null },
    userId: { type: String, default: null },
    reason: { type: String, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

inventoryMovementSchema.index({ productId: 1, createdAt: -1 });

export default mongoose.model('InventoryMovement', inventoryMovementSchema);
