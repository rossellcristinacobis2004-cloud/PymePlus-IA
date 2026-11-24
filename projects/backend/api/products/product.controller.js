import mongoose from 'mongoose';
import Product, { PRODUCT_CATEGORIES } from './product.model.js';
import { ok, created, paginate } from '../../helpers/response.js';
import { badRequest, notFound, conflict } from '../../helpers/errors.js';
import {
  validateBarcode,
  requireString,
  requirePositiveNumber,
  requireNumber,
  positiveInt
} from '../../helpers/validators.js';
import { getActiveRate } from '../../services/exchange-rate.service.js';
import { serializeProduct } from '../../helpers/serializers.js';
import { decrementStock, increaseStock } from '../../services/inventory.service.js';

const ADJUSTMENT_REASONS = ['RECEIPT', 'COUNT_CORRECTION', 'DAMAGE', 'THEFT', 'RETURN', 'EXPIRED_DISPOSAL'];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertObjectId(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Producto');
}

function parseBatchDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest('La fecha del lote no es válida.', { field });
  }
  return date;
}

function parseBatches(batches = []) {
  if (!Array.isArray(batches)) throw badRequest('El campo batches debe ser una lista.', { field: 'batches' });
  return batches.map((batch, index) => {
    if (!batch || typeof batch !== 'object' || Array.isArray(batch)) {
      throw badRequest('Cada lote debe ser un objeto.', { field: `batches[${index}]` });
    }
    const lot = requireString(batch.lot, 'batch.lot');
    const quantity = requireNumber(batch.quantity, `batches[${index}].quantity`, { min: 0 });
    return {
      lot,
      quantity,
      manufacturingDate: parseBatchDate(batch.manufacturingDate, `batches[${index}].manufacturingDate`),
      expirationDate: parseBatchDate(batch.expirationDate, `batches[${index}].expirationDate`)
    };
  });
}

function resolveCategory(value) {
  const category = String(value || 'General');
  if (!PRODUCT_CATEGORIES.includes(category)) {
    throw badRequest('Categoría no válida.', {
      field: 'category',
      userMessage: 'Selecciona una categoría válida.',
      suggestion: PRODUCT_CATEGORIES.join(', ')
    });
  }
  return category;
}

export async function list(req, res, next) {
  try {
    const page = positiveInt(req.query.page, 'page', 1);
    const limit = positiveInt(req.query.limit, 'limit', 20);
    const filter = {};

    if (req.query.active !== undefined) filter['flags.active'] = req.query.active === 'true';

    const search = req.query.q || req.query.search;
    if (search) {
      const term = escapeRegExp(search);
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { sku: { $regex: term, $options: 'i' } },
        { barcode: { $regex: term, $options: 'i' } }
      ];
    }
    if (req.query.sku) filter.sku = String(req.query.sku).toUpperCase();
    if (req.query.barcode) filter.barcode = String(req.query.barcode);
    if (req.query.category) filter.category = resolveCategory(req.query.category);
    if (req.query.categoryId && mongoose.isValidObjectId(req.query.categoryId)) {
      filter.categoryId = req.query.categoryId;
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
    return ok(res, {
      data: docs.map((doc) => serializeProduct(doc, rate)),
      message: 'Productos obtenidos correctamente.',
      meta: { pagination: paginate({ page, limit, total }) }
    });
  } catch (error) {
    return next(error);
  }
}

export async function lowStock(req, res, next) {
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
}

export async function expiring(req, res, next) {
  try {
    const days = requireNumber(req.query.days ?? 30, 'days', { min: 0, max: 3650 });
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
}

export async function getByBarcode(req, res, next) {
  try {
    const barcode = validateBarcode(req.params.barcode);
    const doc = await Product.findOne({ barcode, 'flags.active': true }).lean();
    if (!doc) throw notFound('Producto');
    const rate = await getActiveRate();
    return ok(res, { data: serializeProduct(doc, rate) });
  } catch (error) {
    return next(error);
  }
}

export async function getBySku(req, res, next) {
  try {
    const doc = await Product.findOne({ sku: String(req.params.sku).toUpperCase() }).lean();
    if (!doc) throw notFound('Producto');
    const rate = await getActiveRate();
    return ok(res, { data: serializeProduct(doc, rate) });
  } catch (error) {
    return next(error);
  }
}

export async function getById(req, res, next) {
  try {
    assertObjectId(req.params.id);
    const doc = await Product.findById(req.params.id).lean();
    if (!doc) throw notFound('Producto');
    const rate = await getActiveRate();
    return ok(res, { data: serializeProduct(doc, rate) });
  } catch (error) {
    return next(error);
  }
}

export async function create(req, res, next) {
  try {
    const body = req.body || {};
    const doc = await Product.create({
      sku: requireString(body.sku, 'sku').toUpperCase(),
      barcode: body.barcode ? validateBarcode(body.barcode) : undefined,
      name: requireString(body.name, 'name'),
      description: body.description || '',
      category: resolveCategory(body.category || body.categoryName),
      categoryId: body.categoryId || null,
      imageUrl: body.imageUrl || null,
      pricing: {
        priceIncludesTax: Boolean(body.priceIncludesTax),
        tax: body.taxType || 'IVA_GENERAL',
        costUSD: requireNumber(body.costUSD ?? 0, 'costUSD', { min: 0 }),
        priceUSD: requirePositiveNumber(body.priceUSD, 'priceUSD'),
        manualPriceVES:
          body.manualPriceVES !== undefined ? requireNumber(body.manualPriceVES, 'manualPriceVES', { min: 0 }) : null,
        promotionPriceUSD:
          body.promotionPriceUSD !== undefined
            ? requireNumber(body.promotionPriceUSD, 'promotionPriceUSD', { min: 0 })
            : null,
        mode: body.pricingMode || 'AUTO_BCV'
      },
      stock: {
        available: requireNumber(body.stockCurrent ?? body.stock ?? 0, 'stockCurrent', { min: 0 }),
        minimum: requireNumber(body.stockMinimum ?? body.minimumStock ?? 0, 'stockMinimum', { min: 0 }),
        unit: body.unit || 'UN'
      },
      batches: parseBatches(body.batches),
      flags: {
        active: body.isActive !== false,
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
}

export async function update(req, res, next) {
  try {
    assertObjectId(req.params.id);
    const body = req.body || {};
    const updates = { 'audit.updatedBy': req.user.id };

    // Acepta campos planos y la forma anidada `pricing` descrita en el contrato.
    const pricing = body.pricing && typeof body.pricing === 'object' ? body.pricing : {};
    const value = (key) => (body[key] !== undefined ? body[key] : pricing[key]);

    if (body.name !== undefined) updates.name = requireString(body.name, 'name');
    if (body.description !== undefined) updates.description = String(body.description);
    if (body.category !== undefined) updates.category = resolveCategory(body.category);
    if (body.imageUrl !== undefined) updates.imageUrl = body.imageUrl || null;
    if (value('priceUSD') !== undefined) updates['pricing.priceUSD'] = requirePositiveNumber(value('priceUSD'), 'priceUSD');
    if (value('costUSD') !== undefined) {
      updates['pricing.costUSD'] = requireNumber(value('costUSD'), 'costUSD', { min: 0 });
    }
    if (value('manualPriceVES') !== undefined) {
      updates['pricing.manualPriceVES'] = requireNumber(value('manualPriceVES'), 'manualPriceVES', { min: 0 });
    }
    if (value('promotionPriceUSD') !== undefined) {
      updates['pricing.promotionPriceUSD'] = requireNumber(value('promotionPriceUSD'), 'promotionPriceUSD', { min: 0 });
    }
    if (value('taxType') !== undefined) updates['pricing.tax'] = value('taxType');
    if (value('priceIncludesTax') !== undefined) updates['pricing.priceIncludesTax'] = Boolean(value('priceIncludesTax'));
    if (body.stockMinimum !== undefined || body.minimumStock !== undefined) {
      updates['stock.minimum'] = requireNumber(body.stockMinimum ?? body.minimumStock, 'stockMinimum', { min: 0 });
    }
    if (body.unit !== undefined) updates['stock.unit'] = String(body.unit);
    if (body.barcode !== undefined) updates.barcode = validateBarcode(body.barcode);
    if (value('pricingMode') !== undefined) updates['pricing.mode'] = value('pricingMode');
    if (body.batches !== undefined) updates.batches = parseBatches(body.batches);

    const doc = await Product.findByIdAndUpdate(req.params.id, { $set: updates }, { returnDocument: 'after', runValidators: true }).lean();
    if (!doc) throw notFound('Producto');
    const rate = await getActiveRate();
    return ok(res, { data: serializeProduct(doc, rate), message: 'Producto actualizado correctamente.' });
  } catch (error) {
    return next(error);
  }
}

export async function remove(req, res, next) {
  try {
    assertObjectId(req.params.id);
    const doc = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: { 'flags.active': false, 'audit.updatedBy': req.user.id } },
      { returnDocument: 'after' }
    ).lean();
    if (!doc) throw notFound('Producto');
    return ok(res, { data: { id: String(doc._id), isActive: false, active: false }, message: 'Producto dado de baja.' });
  } catch (error) {
    return next(error);
  }
}

export async function adjustStock(req, res, next) {
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
}
