import 'dotenv/config';
import Product from '../api/products/product.model.js';
import { PRODUCT_CATEGORIES } from '../api/products/product.model.js';
import { connectDatabase, disconnectDatabase } from '../databases/mongodb.js';

/**
 * Migración no destructiva: convierte categorías antiguas `{ name, id, defaultTax }`
 * al enum String exigido por el contrato de inventario. Los demás campos intactos.
 */
async function migrate() {
  await connectDatabase();
  const legacy = await Product.collection.find({ category: { $type: 'object' } }).toArray();
  let converted = 0;

  for (const doc of legacy) {
    const name = doc.category?.name;
    const category = PRODUCT_CATEGORIES.includes(name) ? name : 'General';
    await Product.updateOne(
      { _id: doc._id },
      { $set: { category, categoryId: doc.category?.id || null } }
    );
    converted += 1;
  }

  console.log(`[MIGRATE] Productos convertidos: ${converted}`);
}

migrate()
  .catch((error) => {
    console.error('[MIGRATE] Error:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
