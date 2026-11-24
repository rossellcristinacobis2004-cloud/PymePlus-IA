import Product from '../api/products/product.model.js';
import InventoryMovement from '../api/inventory/inventory-movement.model.js';
import Sequence from '../api/inventory/sequence.model.js';
import { conflict } from '../helpers/errors.js';

function validQuantity(quantity) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw conflict('INVALID_QUANTITY', 'La cantidad de inventario no es válida.', {
      userMessage: 'La cantidad no es válida.',
      suggestion: 'Usa una cantidad mayor que cero.'
    });
  }
  return qty;
}

function batchIsExpired(batch, now = new Date()) {
  return Boolean(batch?.expirationDate && new Date(batch.expirationDate) < now);
}

/**
 * Descuento atómico: el filtro incluye la condición de stock suficiente,
 * por lo que MongoDB evalúa filtro + $inc como una única operación.
 * Nunca se usa el patrón leer-verificar-escribir en memoria.
 */
export async function decrementStock({
  productId,
  quantity,
  lot = null,
  session = null,
  userId = null,
  saleId = null,
  reason = 'SALE_OUT',
  allowExpired = false
}) {
  const qty = validQuantity(quantity);
  const now = new Date();
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
      ...(allowExpired ? {} : { 'batches.expirationDate': { $gte: now } })
    })
      .select('batches')
      .session(session)
      .lean();

    // El findOne puede haber coincidido con otro lote: vuelve a filtrar en memoria.
    const usable = candidate?.batches?.find(
      (batch) =>
        batch.quantity >= qty &&
        (allowExpired || !batch.expirationDate || new Date(batch.expirationDate) >= now)
    );
    selectedLot = usable?.lot || null;
  } else if (!allowExpired) {
    const product = await Product.findOne({ _id: productId }).select('batches').session(session).lean();
    const chosen = product?.batches?.find((batch) => batch.lot === selectedLot);
    if (!chosen || chosen.quantity < qty) {
      throw conflict('INSUFFICIENT_STOCK', 'El lote seleccionado no tiene suficiente stock.', {
        userMessage: 'El lote seleccionado no tiene suficientes unidades.',
        suggestion: 'Selecciona otro lote o ajusta la cantidad.'
      });
    }
    if (batchIsExpired(chosen, now)) {
      throw conflict('EXPIRED_BATCH', 'El lote seleccionado está vencido.', {
        userMessage: 'El lote está vencido. Usa otro lote.',
        suggestion: 'Revisa la fecha de vencimiento del producto.'
      });
    }
  }

  if (selectedLot) {
    filter.batches = {
      $elemMatch: {
        lot: selectedLot,
        quantity: { $gte: qty },
        ...(allowExpired ? {} : { $or: [{ expirationDate: null }, { expirationDate: { $gte: now } }] })
      }
    };
  }

  const before = await Product.findOne(filter).session(session).lean();
  if (!before) {
    throw conflict('INSUFFICIENT_STOCK', 'Stock insuficiente para la operación.', {
      userMessage: 'No hay suficiente stock disponible para completar la venta.',
      suggestion: 'Ajusta la cantidad o revisa el inventario disponible.'
    });
  }

  const update = { $inc: { 'stock.available': -qty } };
  if (selectedLot) {
    update.$inc['batches.$.quantity'] = -qty;
  }

  const after = await Product.findOneAndUpdate(filter, update, { returnDocument: 'after', session }).lean();

  if (!after) {
    throw conflict('TRANSACTION_CONFLICT', 'El stock cambió durante la operación.', {
      userMessage: 'Otro cajero modificó el stock. Revisa la existencia e inténtalo de nuevo.',
      suggestion: 'Reintenta la operación.',
      retryable: true
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
export async function increaseStock({
  productId,
  quantity,
  lot = null,
  session = null,
  userId = null,
  saleId = null,
  reason = 'SALE_VOID',
  allowExpired = true
}) {
  const qty = validQuantity(quantity);
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
    const hasLot = (before.batches || []).some((batch) => batch.lot === lot);
    if (!hasLot) {
      throw conflict('INVALID_LOT', 'El lote de la venta ya no existe.', {
        userMessage: 'No se puede restaurar el lote original.',
        suggestion: 'Revisa el inventario del producto.'
      });
    }
    filter.batches = { $elemMatch: { lot } };
    update.$inc['batches.$.quantity'] = qty;
  }

  const after = await Product.findOneAndUpdate(filter, update, { returnDocument: 'after', session }).lean();
  if (!after) {
    throw conflict('TRANSACTION_CONFLICT', 'El inventario cambió durante la anulación.', {
      userMessage: 'Otro movimiento modificó el inventario. Inténtalo de nuevo.',
      suggestion: 'Reintenta la anulación.',
      retryable: true
    });
  }

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
