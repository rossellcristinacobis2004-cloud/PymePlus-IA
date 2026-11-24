import { Router } from 'express';
import mongoose from 'mongoose';
import Customer from './customer.model.js';
import Sale from '../sales/sale.model.js';
import { requireAuth, requireRole } from '../../middlewares/auth.js';
import { ok, created, paginate } from '../../helpers/response.js';
import { badRequest, notFound, conflict } from '../../helpers/errors.js';
import {
  validateEmail,
  validateDocument,
  requireString,
  requireNumber,
  positiveInt
} from '../../helpers/validators.js';
import { money, round2 } from '../../helpers/money.js';
import { getActiveRate } from '../../services/exchange-rate.service.js';

const router = Router();

// Almacén no consulta clientes, ventas ni estados de cuenta.
const CUSTOMER_READ_ROLES = ['ADMIN', 'SUPERVISOR', 'FINANCE', 'CASHIER'];

function serializeCustomer(customer, rate, stats = null) {
  const plain = typeof customer.toObject === 'function' ? customer.toObject() : customer;
  const snap = rate
    ? { value: rate.value, source: rate.source, date: rate.date, isFallback: Boolean(rate.isFallback) }
    : null;

  return {
    id: String(plain._id),
    name: plain.name,
    documentType: plain.documentType,
    documentNumber: plain.documentNumber,
    email: plain.email,
    phone: plain.phone,
    address: plain.address,
    credit: {
      enabled: plain.credit.enabled,
      limit: money(plain.credit.limitUSD, 'USD'),
      balance: money(plain.credit.balanceUSD, 'USD'),
      days: plain.credit.days
    },
    stats: stats
      ? {
          totalPurchases: money(stats.total, 'USD'),
          salesCount: stats.count,
          lastPurchaseAt: stats.lastPurchaseAt
        }
      : { totalPurchases: money(0, 'USD'), salesCount: 0, lastPurchaseAt: null },
    flags: { active: plain.active, isTaxExempt: plain.isTaxExempt },
    creditInVES: money(toVesSafe(plain.credit.limitUSD, rate), 'VES', snap),
    audit: { createdAt: plain.createdAt, updatedAt: plain.updatedAt }
  };
}

function toVesSafe(amount, rate) {
  return round2(Number(amount) * Number(rate?.value || 0));
}

function validateCustomerBody(body, partial = false) {
  const payload = {};

  if (!partial || body.name !== undefined) payload.name = requireString(body.name, 'name');
  if (!partial || body.documentType !== undefined || body.documentNumber !== undefined) {
    Object.assign(
      payload,
      validateDocument(body.documentType, body.documentNumber)
    );
  }
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    payload.email = validateEmail(body.email);
  }
  if (body.phone !== undefined) payload.phone = String(body.phone);
  if (body.address !== undefined) {
    // Whitelist: nunca se almacenan campos arbitrarios del cliente.
    const address = body.address && typeof body.address === 'object' ? body.address : {};
    payload.address = {
      street: address.street !== undefined ? String(address.street) : '',
      city: address.city !== undefined ? String(address.city) : '',
      state: address.state !== undefined ? String(address.state) : '',
      country: address.country !== undefined ? String(address.country) : 'VE'
    };
  }
  if (body.isTaxExempt !== undefined) {
    payload.isTaxExempt = Boolean(body.isTaxExempt);
    if (payload.isTaxExempt && !body.exemptionCertificate) {
      throw badRequest('Se requiere certificado de exención.', {
        field: 'exemptionCertificate',
        userMessage: 'Para aplicar exención de IVA se requiere el certificado y el motivo.',
        suggestion: 'Adjunta el número de certificado.'
      });
    }
    if (payload.isTaxExempt) payload.exemptionCertificate = requireString(body.exemptionCertificate, 'exemptionCertificate');
  }
  if (body.credit !== undefined) {
    if (!body.credit || typeof body.credit !== 'object' || Array.isArray(body.credit)) {
      throw badRequest('El crédito no es válido.', { field: 'credit' });
    }
    // `balanceUSD` jamás viene del cliente: solo se modifica con ventas/anulaciones.
    // En PATCH solo se envían las claves presentes para no borrar el límite actual.
    const credit = {};
    if (body.credit.enabled !== undefined) credit.enabled = Boolean(body.credit.enabled);
    if (body.credit.limitUSD !== undefined) {
      credit.limitUSD = requireNumber(body.credit.limitUSD, 'credit.limitUSD', { min: 0 });
    }
    if (body.credit.days !== undefined) {
      credit.days = requireNumber(body.credit.days, 'credit.days', { min: 0, max: 3650 });
    }
    if (Object.keys(credit).length) payload.credit = credit;
  }

  return payload;
}

router.get('/', requireAuth, requireRole(...CUSTOMER_READ_ROLES), async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.active !== undefined) filter.active = req.query.active === 'true';
    if (req.query.search) {
      const term = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { documentNumber: { $regex: term, $options: 'i' } }
      ];
    }
    if (req.query.documentNumber) filter.documentNumber = String(req.query.documentNumber).toUpperCase();
    if (req.query.hasCredit === 'true') filter['credit.enabled'] = true;

    const page = positiveInt(req.query.page, 'page', 1);
    const limit = positiveInt(req.query.limit, 'limit', 20);
    const total = await Customer.countDocuments(filter);
    const docs = await Customer.find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const rate = await getActiveRate();
    return ok(res, {
      data: docs.map((doc) => serializeCustomer(doc, rate)),
      meta: { pagination: paginate({ page, limit, total }) }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', requireAuth, requireRole(...CUSTOMER_READ_ROLES), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Cliente');
    const doc = await Customer.findById(req.params.id).lean();
    if (!doc) throw notFound('Cliente');
    const rate = await getActiveRate();
    return ok(res, { data: serializeCustomer(doc, rate) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/sales', requireAuth, requireRole(...CUSTOMER_READ_ROLES), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Cliente');
    const docs = await Sale.find({ customerId: req.params.id })
      .sort({ 'audit.createdAt': -1 })
      .limit(100)
      .lean();
    return ok(res, { data: docs });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/statement', requireAuth, requireRole(...CUSTOMER_READ_ROLES), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Cliente');
    const customer = await Customer.findById(req.params.id).lean();
    if (!customer) throw notFound('Cliente');

    const [stats] = await Sale.aggregate([
      { $match: { customerId: customer._id, status: 'COMPLETED' } },
      {
        $group: {
          _id: null,
          total: { $sum: '$totals.total.amount' },
          count: { $sum: 1 },
          lastPurchaseAt: { $max: '$audit.createdAt' }
        }
      }
    ]);

    const rate = await getActiveRate();
    return ok(res, {
      data: {
        customer: serializeCustomer(customer, rate, stats || null),
        movements: [
          {
            type: 'SALES_TOTAL',
            amountUSD: round2(stats?.total || 0),
            count: stats?.count || 0
          },
          {
            type: 'CREDIT_BALANCE',
            amountUSD: round2(customer.credit.balanceUSD)
          }
        ]
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRole('ADMIN', 'CASHIER', 'SUPERVISOR'), async (req, res, next) => {
  try {
    const payload = validateCustomerBody(req.body || {});
    const doc = await Customer.create(payload);
    const rate = await getActiveRate();
    return created(res, serializeCustomer(doc, rate), 'Cliente creado correctamente.');
  } catch (error) {
    if (error.code === 11000) {
      return next(conflict('DUPLICATE_KEY', 'Documento ya registrado.', {
        userMessage: 'Ya existe un cliente con ese documento.',
        suggestion: 'Verifica el número de RIF, CI o pasaporte.'
      }));
    }
    return next(error);
  }
});

router.patch('/:id', requireAuth, requireRole('ADMIN', 'SUPERVISOR'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Cliente');
    const payload = validateCustomerBody(req.body || {}, true);
    if (payload.credit) {
      const credit = payload.credit;
      delete payload.credit;
      for (const [key, value] of Object.entries(credit)) {
        payload[`credit.${key}`] = value;
      }
    }
    const doc = await Customer.findByIdAndUpdate(req.params.id, { $set: payload }, { returnDocument: 'after', runValidators: true }).lean();
    if (!doc) throw notFound('Cliente');
    const rate = await getActiveRate();
    return ok(res, { data: serializeCustomer(doc, rate), message: 'Cliente actualizado correctamente.' });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Cliente');
    const doc = await Customer.findByIdAndUpdate(req.params.id, { $set: { active: false } }, { returnDocument: 'after' }).lean();
    if (!doc) throw notFound('Cliente');
    return ok(res, { data: { id: String(doc._id), active: false }, message: 'Cliente dado de baja.' });
  } catch (error) {
    return next(error);
  }
});

export default router;
