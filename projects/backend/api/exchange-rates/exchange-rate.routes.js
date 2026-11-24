import { Router } from 'express';
import ExchangeRate from './exchange-rate.model.js';
import { requireAuth, requireRole } from '../../middlewares/auth.js';
import { ok, created, paginate } from '../../helpers/response.js';
import { badRequest } from '../../helpers/errors.js';
import { getActiveRate } from '../../services/exchange-rate.service.js';
import { rateSnapshot } from '../../helpers/money.js';
import { positiveInt } from '../../helpers/validators.js';

const router = Router();

// Almacén no consulta tasas; CASHIER sí la necesita para facturar.
const RATE_READ_ROLES = ['ADMIN', 'SUPERVISOR', 'FINANCE', 'CASHIER'];
const STATUSES = ['ACTIVE', 'STALE', 'EXPIRED', 'PENDING_REVIEW'];
const SOURCES = ['BCV', 'MANUAL'];

router.get('/current', requireAuth, requireRole(...RATE_READ_ROLES), async (_req, res, next) => {
  try {
    const rate = await getActiveRate();
    return ok(res, {
      data: {
        ...rateSnapshot(rate),
        reason: rate.reason || null,
        sourceUpdatedAt: rate.sourceUpdatedAt || null,
        ageHours: (Date.now() - new Date(rate.capturedAt).getTime()) / 3_600_000
      },
      message: 'Tasa BCV vigente obtenida.'
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/history', requireAuth, requireRole(...RATE_READ_ROLES), async (req, res, next) => {
  try {
    const page = positiveInt(req.query.page, 'page', 1);
    const limit = positiveInt(req.query.limit, 'limit', 20);
    const filter = {};
    if (req.query.source) {
      const source = String(req.query.source).toUpperCase();
      if (!SOURCES.includes(source)) throw badRequest('Fuente no soportada.', { field: 'source' });
      filter.source = source;
    }
    if (req.query.status) {
      const status = String(req.query.status).toUpperCase();
      if (!STATUSES.includes(status)) throw badRequest('Estado no soportado.', { field: 'status' });
      filter.status = status;
    }
    if (req.query.from || req.query.to) {
      const from = req.query.from === undefined ? undefined : String(req.query.from);
      const to = req.query.to === undefined ? undefined : String(req.query.to);
      for (const [field, value] of [['from', from], ['to', to]]) {
        if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw badRequest(`La fecha ${field} no es válida.`, { field });
        }
      }
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }

    const total = await ExchangeRate.countDocuments(filter);
    const docs = await ExchangeRate.find(filter)
      .sort({ date: -1, capturedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
      throw badRequest('La fecha debe tener formato YYYY-MM-DD.', { field: 'date' });
    }
    const value = Number(req.body?.value);
    if (!Number.isFinite(value) || value <= 0) {
      throw badRequest('El valor de la tasa debe ser mayor que cero.', { field: 'value' });
    }
    const source = String(req.body?.source || 'BCV');
    if (!SOURCES.includes(source)) {
      throw badRequest('Fuente no soportada.', { field: 'source' });
    }
    const status = String(req.body?.status || 'ACTIVE');
    if (!STATUSES.includes(status)) {
      throw badRequest('Estado no soportado.', { field: 'status' });
    }
    // Una tasa marcada como revisión o vencida necesita dejar constancia del motivo.
    const reason = String(req.body?.reason || '').trim();
    if (status !== 'ACTIVE' && reason.length < 4) {
      throw badRequest('Se requiere el motivo del cambio de estado.', { field: 'reason' });
    }

    const doc = await ExchangeRate.findOneAndUpdate(
      { date, source },
      {
        $set: {
          value,
          status,
          isFallback: false,
          reason: reason || null,
          verifiedBy: req.user.id,
          capturedAt: new Date()
        }
      },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );

    const io = req.app.get('io');
    if (io && status === 'ACTIVE' && source === 'BCV') {
      // Solo sockets con JWT pertenecen a la sala autenticada.
      io.to('authenticated').emit('exchangeRate:updated', {
        ...rateSnapshot(doc),
        reason: doc.reason || null,
        sourceUpdatedAt: doc.sourceUpdatedAt || null
      });
    }

    return created(res, doc, 'Tasa BCV registrada correctamente.');
  } catch (error) {
    return next(error);
  }
});

export default router;
