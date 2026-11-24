import mongoose from 'mongoose';

const sequenceSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 }
  },
  { versionKey: false }
);

export default mongoose.model('Sequence', sequenceSchema);
