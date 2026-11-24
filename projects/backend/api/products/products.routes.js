import { Router } from 'express';
import mongoose from 'mongoose';
import Product from './product.model.js';
import { requireAuth, requireRole } from '../../middlewares/auth.js';
import { ok, created, paginate } from '../../helpers/response.js';
import { badRequest, notFound, conflict } from '../../helpers/errors.js';
import { validateBarcode, requireString, requirePositiveNumber } from '../../helpers/validators.js';
import { getActiveRate } from '../../services/exchange-rate.service.js';
import { serializeProduct } from '../../helpers/serializers.js';
import { decrementStock, increaseStock } from '../../services/inventory.service.js';

const router = Router();
const ADJUSTMENT_REASONS = ['RECEIPT', 'COUNT_CORRECTION', 'DAMAGE', 'THEFT', 'RETURN', 'EXPIRED_DISPOSAL'];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertObjectId(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Producto');
}

function parseBatches(batches = []) {
  if (!Array.isArray(batches)) throw badRequest('El campo batches debe ser una lista.', { field: 'batches' });
  return batches.map((batch) => {
    const lot = requireString(batch.lot, 'batch.lot');
    const quantity = Number(batch.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw badRequest('La cantidad del lote debe ser mayor o igual a cero.', { field: 'batch.quantity' });
    }
    return {
      lot,
      quantity,
      manufacturingDate: batch.manufacturingDate ? new Date(batch.manufacturingDate) : null,
      expirationDate: batch.expirationDate ? new Date(batch.expirationDate) : null
    };
  });
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const filter = {};

    if (req.query.active !== undefined) {
      filter['flags.active'] = req.query.active === 'true';
    }

    if (req.query.search) {
      const term = escapeRegExp(req.query.search);
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { sku: { $regex: term, $options: 'i' } },
        { barcode: { $regex: term, $options: 'i' } }
      ];
    }
    if (req.query.sku) filter.sku = String(req.query.sku).toUpperCase();
    if (req.query.barcode) filter.barcode = String(req.query.barcode);
    if (req.query.categoryId && mongoose.isValidObjectId(req.query.categoryId)) {
      filter['category.id'] = req.query.categoryId;
    }
    if (req.query.lowStockOnly === 'true') {
      filter.$expr = { $lte: ['$stock.available', '$stock.minimum'] };
    }
    if (req.query.expiringDays) {
      const days = Number(req.query.expiringDays);
      if (!Number.isFinite(days) || days < 0) throw badRequest('expiringDays no es válido.', { field: 'expiringDays' });
      filter['batches.expirationDate'] = { $lte: new Date(Date.now() + days * 86_400_000) };
    }

    const [sortField, sortDir] = String(req.query.sort || 'createdAt:desc').split(':');
    const allowedSort = ['createdAt', 'name', 'sku', 'stock.available'];
    const sort = allowedSort.includes(sortField) ? { [sortField]: sortDir === 'asc' ? 1 : -1 } : { createdAt: -1 };

    const total = await Product.countDocuments(filter);
    const docs = await Product.find(filter)
      .sort(sort)
      .skip((Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit)))
      .limit(Math.min(100, Math.max(1, limit)))
      .lean();

    const rate = await getActiveRate();
    const pagination = paginate({ page, limit, total });

    return ok(res, {
      data: docs.map((doc) => serializeProduct(doc, rate)),
      message: 'Productos obtenidos correctamente.',
      meta: { pagination }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/low-stock', requireAuth, async (req, res, next) => {
  try {
    const docs = await Product.find({
      'flags.active': true,
      $expr: { $lte: ['$stock.available', '$stock.minimum'] }
    }).lean();
    const rate = await getActiveRate();
    return ok(res, { data: docs.map((doc) => serializeProduct(doc, rate)) });
  } catch (error) {
    return next(error);
  }
});

router.get('/expiring', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days || 30);
    const limitDate = new Date(Date.now() + days * 86_400_000);
    const docs = await Product.find({
      'flags.active': true,
      batches: { $elemMatch: { quantity: { $gt: 0 }, expirationDate: { $lte: limitDate } } }
    }).lean();
    const rate = await getActiveRate();
    return ok(res, { data: docs.map((doc) => serializeProduct(doc, rate)) });
  } catch (error) {
    return next(error);
  }
});

router.get('/barcode/:barcode', requireAuth, async (req, res, next) => {
  try {
    const barcode = validateBarcode(req.params.barcode);
    const doc = await Product.findOne({ barcode, 'flags.active': true }).lean();
    if (!doc) throw notFound('Producto');
    const rate = await getActiveRate();
    return ok(res, { data: serializeProduct(doc, rate) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    assertObjectId(req.params.id);
    const doc = await Product.findById(req.params.id).lean();
    if (!doc) throw notFound('Producto');
    const rate = await getActiveRate();
    return ok(res, { data: serializeProduct(doc, rate) });
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRole('ADMIN', 'WAREHOUSE'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const doc = await Product.create({
      sku: requireString(body.sku, 'sku').toUpperCase(),
      barcode: body.barcode ? validateBarcode(body.barcode) : undefined,
      name: requireString(body.name, 'name'),
      description: body.description || '',
      category: {
        name: body.categoryName || 'General',
        defaultTax: body.categoryTax || 'IVA_GENERAL'
      },
      pricing: {
        priceIncludesTax: Boolean(body.priceIncludesTax),
        tax: body.taxType || 'IVA_GENERAL',
        costUSD: Number(body.costUSD || 0),
        priceUSD: requirePositiveNumber(body.priceUSD, 'priceUSD'),
        mode: body.pricingMode || 'AUTO_BCV'
      },
      stock: {
        available: Number(body.stock || 0),
        minimum: Number(body.minimumStock || 0),
        unit: body.unit || 'UN'
      },
      batches: parseBatches(body.batches),
      flags: {
        trackExpiration: body.trackExpiration !== false,
        blockExpiredSale: body.blockExpiredSale !== false
      },
      audit: { createdBy: req.user.id, updatedBy: req.user.id }
    });

    const rate = await getActiveRate();
    return created(res, serializeProduct(doc, rate), 'Producto creado correctamente.');
  } catch (error) {
    if (error.code === 11000) {
      return next(conflict('DUPLICATE_KEY', 'SKU o código de barras ya registrado.', {
        userMessage: 'Ya existe un producto con ese SKU o código de barras.',
        suggestion: 'Usa un identificador diferente.'
      }));
    }
    return next(error);
  }
});

router.patch('/:id', requireAuth, requireRole('ADMIN', 'WAREHOUSE'), async (req, res, next) => {
  try {
    assertObjectId(req.params.id);
    const body = req.body || {};
    const updates = { audit: { updatedBy: req.user.id } };

    if (body.name !== undefined) updates.name = requireString(body.name, 'name');
    if (body.description !== undefined) updates.description = String(body.description);
    if (body.priceUSD !== undefined) updates['pricing.priceUSD'] = requirePositiveNumber(body.priceUSD, 'priceUSD');
    if (body.costUSD !== undefined) updates['pricing.costUSD'] = Number(body.costUSD);
    if (body.taxType !== undefined) updates['pricing.tax'] = body.taxType;
    if (body.minimumStock !== undefined) updates['stock.minimum'] = Number(body.minimumStock);
    if (body.unit !== undefined) updates['stock.unit'] = String(body.unit);
    if (body.barcode !== undefined) updates.barcode = validateBarcode(body.barcode);
    if (body.pricingMode !== undefined) updates['pricing.mode'] = body.pricingMode;
    if (body.batches !== undefined) updates.batches = parseBatches(body.batches);

    const doc = await Product.findByIdAndUpdate(req.params.id, { $set: updates }, { returnDocument: 'after', runValidators: true }).lean();
    if (!doc) throw notFound('Producto');
    const rate = await getActiveRate();
    return ok(res, { data: serializeProduct(doc, rate), message: 'Producto actualizado correctamente.' });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    assertObjectId(req.params.id);
    const doc = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: { 'flags.active': false, 'audit.updatedBy': req.user.id } },
      { returnDocument: 'after' }
    ).lean();
    if (!doc) throw notFound('Producto');
    return ok(res, { data: { id: String(doc._id), active: false }, message: 'Producto dado de baja.' });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/stock-adjustments', requireAuth, requireRole('ADMIN', 'WAREHOUSE'), async (req, res, next) => {
  try {
    assertObjectId(req.params.id);
    const reason = req.body?.reason;
    if (!ADJUSTMENT_REASONS.includes(reason)) {
      throw badRequest('Motivo de ajuste no válido.', {
        field: 'reason',
        userMessage: 'Selecciona un motivo de ajuste válido.',
        suggestion: ADJUSTMENT_REASONS.join(', ')
      });
    }

    const quantity = Number(req.body?.quantity);
    if (!Number.isFinite(quantity) || quantity === 0) {
      throw badRequest('La cantidad del ajuste debe ser distinta de cero.', { field: 'quantity' });
    }

    const session = await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        result = quantity < 0
          ? await decrementStock({
              productId: req.params.id,
              quantity: Math.abs(quantity),
              lot: req.body.lot || null,
              session,
              userId: req.user.id,
              reason: 'ADJUSTMENT'
            })
          : { product: await increaseStock({
              productId: req.params.id,
              quantity,
              lot: req.body.lot || null,
              session,
              userId: req.user.id,
              reason: 'ADJUSTMENT'
            }) };
      });
    } finally {
      await session.endSession();
    }

    const rate = await getActiveRate();
    return created(res, serializeProduct(result.product, rate), 'Ajuste de inventario registrado.');
  } catch (error) {
    return next(error);
  }
});

export default router;
