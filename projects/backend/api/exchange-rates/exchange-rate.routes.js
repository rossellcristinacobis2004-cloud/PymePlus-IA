import { Router } from 'express';
import ExchangeRate from './exchange-rate.model.js';
import { requireAuth, requireRole } from '../../middlewares/auth.js';
import { ok, created, paginate } from '../../helpers/response.js';
import { badRequest } from '../../helpers/errors.js';
import { getActiveRate } from '../../services/exchange-rate.service.js';
import { rateSnapshot } from '../../helpers/money.js';

const router = Router();

router.get('/current', requireAuth, async (_req, res, next) => {
  try {
    const rate = await getActiveRate();
    return ok(res, {
      data: { ...rateSnapshot(rate), ageHours: (Date.now() - new Date(rate.capturedAt).getTime()) / 3_600_000 },
      message: 'Tasa BCV vigente obtenida.'
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const filter = {};
    if (req.query.source) filter.source = req.query.source;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = String(req.query.from);
      if (req.query.to) filter.date.$lte = String(req.query.to);
    }

    const total = await ExchangeRate.countDocuments(filter);
    const docs = await ExchangeRate.find(filter)
      .sort({ date: -1, capturedAt: -1 })
      .skip((Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit)))
      .limit(Math.min(100, Math.max(1, limit)))
      .lean();

    return ok(res, {
      data: docs,
      message: 'Historial de tasas obtenido.',
      meta: { pagination: paginate({ page, limit, total }) }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRole('ADMIN', 'FINANCE'), async (req, res, next) => {
  try {
    const date = String(req.body?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw badRequest('La fecha debe tener formato YYYY-MM-DD.', { field: 'date' });
    }
    const value = Number(req.body?.value);
    if (!Number.isFinite(value) || value <= 0) {
      throw badRequest('El valor de la tasa debe ser mayor que cero.', { field: 'value' });
    }
    const source = String(req.body?.source || 'BCV');
    if (!['BCV', 'MANUAL'].includes(source)) {
      throw badRequest('Fuente no soportada.', { field: 'source' });
    }

    const doc = await ExchangeRate.findOneAndUpdate(
      { date, source },
      {
        $set: {
          value,
          status: req.body?.status || 'ACTIVE',
          isFallback: false,
          reason: req.body?.reason || null,
          verifiedBy: req.user.id,
          capturedAt: new Date()
        }
      },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );

    return created(res, doc, 'Tasa BCV registrada correctamente.');
  } catch (error) {
    return next(error);
  }
});

export default router;
