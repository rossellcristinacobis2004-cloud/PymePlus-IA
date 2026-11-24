import { Router } from 'express';
import mongoose from 'mongoose';
import Customer from './customer.model.js';
import Sale from '../sales/sale.model.js';
import { requireAuth, requireRole } from '../../middlewares/auth.js';
import { ok, created, paginate } from '../../helpers/response.js';
import { badRequest, notFound, conflict } from '../../helpers/errors.js';
import { validateEmail, validateDocument, requireString } from '../../helpers/validators.js';
import { money, round2 } from '../../helpers/money.js';
import { getActiveRate } from '../../services/exchange-rate.service.js';

const router = Router();

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
  if (body.address !== undefined) payload.address = body.address;
  if (body.isTaxExempt !== undefined) {
    payload.isTaxExempt = Boolean(body.isTaxExempt);
    if (payload.isTaxExempt && !body.exemptionCertificate) {
      throw badRequest('Se requiere certificado de exención.', {
        field: 'exemptionCertificate',
        userMessage: 'Para aplicar exención de IVA se requiere el certificado y el motivo.',
        suggestion: 'Adjunta el número de certificado.'
      });
    }
    if (payload.isTaxExempt) payload.exemptionCertificate = String(body.exemptionCertificate);
  }
  if (body.credit !== undefined) {
    payload.credit = {
      enabled: Boolean(body.credit.enabled),
      limitUSD: Number(body.credit.limitUSD || 0),
      days: Number(body.credit.days || 0)
    };
  }

  return payload;
}

router.get('/', requireAuth, async (req, res, next) => {
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

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const total = await Customer.countDocuments(filter);
    const docs = await Customer.find(filter)
      .sort({ name: 1 })
      .skip((Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit)))
      .limit(Math.min(100, Math.max(1, limit)))
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

router.get('/:id', requireAuth, async (req, res, next) => {
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

router.get('/:id/sales', requireAuth, async (req, res, next) => {
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

router.get('/:id/statement', requireAuth, async (req, res, next) => {
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
