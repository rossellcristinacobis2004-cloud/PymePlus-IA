import mongoose from 'mongoose';

/**
 * Refresh tokens se persisten solo como hash SHA-256. El token en texto plano
 * se entrega una única vez al cliente y nunca se guarda en la base de datos.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, default: null }
  },
  { timestamps: true, versionKey: false }
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('RefreshToken', refreshTokenSchema);
