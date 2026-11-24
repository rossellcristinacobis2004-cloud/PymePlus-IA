import 'dotenv/config';
import User from '../api/auth/user.model.js';
import Product from '../api/products/product.model.js';
import Customer from '../api/customers/customer.model.js';
import ExchangeRate from '../api/exchange-rates/exchange-rate.model.js';
import { connectDatabase, disconnectDatabase } from '../databases/mongodb.js';
import { todayCaracas } from '../helpers/response.js';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@pymeplus.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin12345';
const BCV_RATE = Number(process.env.FALLBACK_BCV_RATE || 36);

async function seed() {
  // El seeder resetea credenciales y crea datos de demostración: nunca en producción.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('El seeder está deshabilitado en producción.');
  }

  await connectDatabase();
  console.log('[SEED] Iniciando datos base de PymePlus IA...');

  let admin = await User.findOne({ email: ADMIN_EMAIL });
  if (!admin) {
    admin = await User.create({
      name: 'Administrador',
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: 'ADMIN'
    });
  } else {
    // No se sobrescribe la contraseña de un administrador existente.
    console.log(`[SEED] El usuario admin ${ADMIN_EMAIL} ya existe; se conserva su contraseña.`);
  }
  console.log(`[SEED] Usuario admin disponible: ${ADMIN_EMAIL}`);

  await ExchangeRate.updateOne(
    { date: todayCaracas(), source: 'BCV' },
    {
      $set: {
        value: BCV_RATE,
        status: 'ACTIVE',
        isFallback: false,
        capturedAt: new Date(),
        reason: 'Carga inicial del seeder'
      }
    },
    { upsert: true }
  );
  console.log(`[SEED] Tasa BCV: ${BCV_RATE}`);

  const products = [
    {
      sku: 'BOD-000001',
      barcode: '7701234567890',
      name: 'Aceite vegetal 1 L',
      pricing: { priceUSD: 6.5, costUSD: 4.2, tax: 'IVA_GENERAL' },
      stock: { available: 24, minimum: 5, unit: 'UN' },
      batches: [{ lot: 'LOT-2026-09-14', quantity: 24, expirationDate: new Date('2027-09-14') }]
    },
    {
      sku: 'FER-000002',
      barcode: '7701234567891',
      name: 'Taladro percutor 800 W',
      pricing: { priceUSD: 78, costUSD: 55, tax: 'IVA_GENERAL' },
      stock: { available: 6, minimum: 2, unit: 'UN' },
      batches: []
    },
    {
      sku: 'BOD-000003',
      barcode: '7701234567892',
      name: 'Arroz blanco 1 kg',
      pricing: { priceUSD: 2.1, costUSD: 1.35, tax: 'IVA_GENERAL' },
      stock: { available: 40, minimum: 10, unit: 'UN' },
      batches: [{ lot: 'LOT-2026-10-01', quantity: 40, expirationDate: new Date('2027-10-01') }]
    }
  ];

  for (const item of products) {
    const exists = await Product.findOne({ sku: item.sku });
    if (!exists) {
      await Product.create({
        ...item,
        category: item.sku.startsWith('FER') ? 'Ferretería' : 'Abarrotes',
        audit: { createdBy: admin.id, updatedBy: admin.id }
      });
      console.log(`[SEED] Producto creado: ${item.name}`);
    }
  }

  const customerExists = await Customer.findOne({ documentNumber: 'J-12345678-9' });
  if (!customerExists) {
    await Customer.create({
      name: 'Comercial La Esquina',
      documentType: 'RIF',
      documentNumber: 'J-12345678-9',
      email: 'contacto@laesquina.ve',
      phone: '+58 412 1234567',
      credit: { enabled: true, limitUSD: 500, balanceUSD: 0, days: 30 }
    });
    console.log('[SEED] Cliente de prueba creado.');
  }

  console.log('[SEED] Proceso finalizado correctamente.');
}

seed()
  .catch((error) => {
    console.error('[SEED] Error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
