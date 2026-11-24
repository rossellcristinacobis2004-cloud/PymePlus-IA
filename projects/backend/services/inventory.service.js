import Product from '../api/products/product.model.js';
import InventoryMovement from '../api/inventory/inventory-movement.model.js';
import Sequence from '../api/inventory/sequence.model.js';
import { conflict } from '../helpers/errors.js';

/**
 * Descuento atómico: el filtro incluye la condición de stock suficiente,
 * por lo que MongoDB evalúa filtro + $inc como una única operación.
 * Nunca se usa el patrón leer-verificar-escribir en memoria.
 */
export async function decrementStock({ productId, quantity, lot = null, session = null, userId = null, saleId = null, reason = 'SALE_OUT' }) {
  const qty = Number(quantity);
  const filter = {
    _id: productId,
    'flags.active': true,
    'stock.available': { $gte: qty }
  };

  let selectedLot = lot;

  if (!selectedLot) {
    const candidate = await Product.findOne({
      _id: productId,
      'batches.quantity': { $gte: qty },
      'batches.expirationDate': { $gte: new Date() }
    })
      .select('batches')
      .session(session)
      .lean();

    selectedLot = candidate?.batches?.find((batch) => batch.quantity >= qty)?.lot || null;
  }

  if (selectedLot) {
    filter.batches = { $elemMatch: { lot: selectedLot, quantity: { $gte: qty } } };
  }

  const before = await Product.findOne(filter).session(session).lean();

  const update = { $inc: { 'stock.available': -qty } };
  if (selectedLot) {
    update.$inc['batches.$.quantity'] = -qty;
  }

  const after = await Product.findOneAndUpdate(filter, update, { returnDocument: 'after', session }).lean();

  if (!after) {
    throw conflict('INSUFFICIENT_STOCK', 'Stock insuficiente para la operación.', {
      userMessage: 'No hay suficiente stock disponible para completar la venta.',
      suggestion: 'Ajusta la cantidad o revisa el inventario disponible.'
    });
  }

  await InventoryMovement.create(
    [
      {
        productId,
        saleId,
        type: reason,
        delta: -qty,
        stockBefore: before.stock.available,
        stockAfter: after.stock.available,
        lot: selectedLot,
        userId,
        reason
      }
    ],
    { session }
  );

  return { product: after, lot: selectedLot };
}

/** Reversión de stock para anulaciones o entradas manuales. */
export async function increaseStock({ productId, quantity, lot = null, session = null, userId = null, saleId = null, reason = 'SALE_VOID' }) {
  const qty = Number(quantity);
  const filter = { _id: productId, 'flags.active': true };
  const before = await Product.findOne(filter).session(session).lean();

  if (!before) {
    throw conflict('NOT_FOUND', 'Producto no encontrado.', {
      userMessage: 'No encontramos el producto asociado a esta operación.',
      suggestion: 'Verifica el producto e inténtalo de nuevo.'
    });
  }

  const update = { $inc: { 'stock.available': qty } };
  if (lot) {
    filter.batches = { $elemMatch: { lot } };
    update.$inc['batches.$.quantity'] = qty;
  }

  const after = await Product.findOneAndUpdate(filter, update, { returnDocument: 'after', session }).lean();

  await InventoryMovement.create(
    [
      {
        productId,
        saleId,
        type: reason,
        delta: qty,
        stockBefore: before.stock.available,
        stockAfter: after.stock.available,
        lot,
        userId,
        reason
      }
    ],
    { session }
  );

  return after;
}

/** Siguiente correlativo atómico (VTA-YYYY-NNNNNN). */
export async function nextSequence(key, session) {
  const year = new Date().getUTCFullYear();
  const doc = await Sequence.findOneAndUpdate(
    { key: `${key}-${year}` },
    { $inc: { value: 1 } },
    { returnDocument: 'after', upsert: true, session }
  ).lean();
  return `${key}-${year}-${String(doc.value).padStart(6, '0')}`;
}
