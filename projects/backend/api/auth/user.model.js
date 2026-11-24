import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// `ADMIN` es el código persistido del rol "Administrador" definido en system_context.md §2.2.
const ROLES = ['ADMIN', 'SUPERVISOR', 'CASHIER', 'WAREHOUSE', 'FINANCE'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'CASHIER' },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null }
  },
  { timestamps: true, versionKey: '__v' }
);

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeObject = function toSafeObject() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    active: this.active
  };
};

export default mongoose.model('User', userSchema);
