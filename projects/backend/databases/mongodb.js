import mongoose from 'mongoose';

export function databaseState() {
  return (
    {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    }[mongoose.connection.readyState] || 'unknown'
  );
}

export async function connectDatabase(uri = process.env.MONGO_URI) {
  if (!uri) {
    console.warn('[DB] MONGO_URI no definida: servidor iniciado sin conexión a MongoDB.');
    return null;
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: Number(process.env.MONGO_TIMEOUT_MS || 5000)
  });
  console.log('[DB] MongoDB conectado correctamente.');
  return mongoose.connection;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('[DB] MongoDB desconectado.');
  }
}
