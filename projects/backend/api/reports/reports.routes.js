import { Router } from 'express';
import Sale from '../sales/sale.model.js';
import Product from '../products/product.model.js';
import { requireAuth } from '../../middlewares/auth.js';
import { ok } from '../../helpers/response.js';
import { badRequest } from '../../helpers/errors.js';
import { money, round2 } from '../../helpers/money.js';
import { getActiveRate, snapshot } from '../../services/exchange-rate.service.js';
import { createSimplePdf } from '../../helpers/pdf.js';

const router = Router();

function dateMatch(from, to) {
  const match = { status: 'COMPLETED' };
  if (from || to) {
    match['audit.createdAt'] = {};
    if (from) match['audit.createdAt'].$gte = new Date(from);
    if (to) match['audit.createdAt'].$lte = new Date(to);
  }
  return match;
}

function period(from, to) {
  return {
    from: from || 'inicio',
    to: to || new Date().toISOString().slice(0, 10),
    timezone: 'America/Caracas'
  };
}

function convert(amount, currency, snap) {
  if (currency === 'VES') return money(round2(Number(amount) * snap.value), 'VES', snap);
  return money(amount, 'USD');
}

async function buildSalesReport({ from, to, groupBy = 'day', currency = 'USD' }, rate) {
  const snap = snapshot(rate);
  const groupExpression =
    groupBy === 'month'
      ? { $dateToString: { format: '%Y-%m', date: '$audit.createdAt', timezone: 'America/Caracas' } }
      : groupBy === 'category'
        ? { $ifNull: [{ $arrayElemAt: ['$items.sku', 0] }, 'N/A'] }
        : { $dateToString: { format: '%Y-%m-%d', date: '$audit.createdAt', timezone: 'America/Caracas' } };

  const rows = await Sale.aggregate([
    { $match: dateMatch(from, to) },
    {
      $group: {
        _id: groupExpression,
        salesCount: { $sum: 1 },
        gross: { $sum: '$totals.subtotal.amount' },
        discounts: { $sum: '$totals.discount.amount' },
        taxableBase: { $sum: '$totals.taxableBase.amount' },
        iva: { $sum: '$totals.iva.amount' },
        total: { $sum: '$totals.total.amount' }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  const totals = rows.reduce(
    (acc, row) => ({
      count: acc.count + row.salesCount,
      gross: acc.gross + row.gross,
      discounts: acc.discounts + row.discounts,
      taxableBase: acc.taxableBase + row.taxableBase,
      iva: acc.iva + row.iva,
      total: acc.total + row.total
    }),
    { count: 0, gross: 0, discounts: 0, taxableBase: 0, iva: 0, total: 0 }
  );

  return {
    reportKey: 'sales',
    period: period(from, to),
    displayCurrency: currency,
    valuationMode: 'historical',
    rateSnapshot: snap,
    summary: {
      salesCount: totals.count,
      grossSales: convert(totals.gross, currency, snap),
      discounts: convert(totals.discounts, currency, snap),
      taxableBase: convert(totals.taxableBase, currency, snap),
      iva: convert(totals.iva, currency, snap),
      netSales: convert(totals.taxableBase, currency, snap)
    },
    series: rows.map((row) => ({
      key: row._id,
      label: row._id,
      metrics: {
        salesCount: row.salesCount,
        total: convert(row.total, currency, snap)
      }
    })),
    alerts: [],
    generatedAt: new Date().toISOString()
  };
}

async function buildIvaReport({ from, to, currency = 'USD' }, rate) {
  const snap = snapshot(rate);
  const rows = await Sale.aggregate([
    { $match: dateMatch(from, to) },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.tax.type',
        lines: { $sum: 1 },
        taxableBase: { $sum: '$items.subtotal.amount' },
        iva: { $sum: '$items.tax.amount.amount' }
      }
    }
  ]);

  const totalIva = round2(rows.reduce((acc, row) => acc + row.iva, 0));
  const totalBase = round2(rows.reduce((acc, row) => acc + row.taxableBase, 0));

  return {
    reportKey: 'iva',
    period: period(from, to),
    displayCurrency: currency,
    rateSnapshot: snap,
    summary: {
      taxableBase: convert(totalBase, currency, snap),
      iva: convert(totalIva, currency, snap),
      exemptBase: convert(rows.find((r) => r._id === 'IVA_EXENTO')?.taxableBase || 0, currency, snap)
    },
    series: rows.map((row) => ({
      key: row._id || 'SIN_IMPUESTO',
      label: row._id || 'SIN_IMPUESTO',
      metrics: {
        lines: row.lines,
        taxableBase: convert(row.taxableBase, currency, snap),
        iva: convert(row.iva, currency, snap)
      }
    })),
    alerts: [],
    generatedAt: new Date().toISOString()
  };
}

async function buildInventoryReport({ currency = 'USD' }, rate) {
  const snap = snapshot(rate);
  const [result] = await Product.aggregate([
    { $match: { 'flags.active': true } },
    {
      $group: {
        _id: null,
        products: { $sum: 1 },
        units: { $sum: '$stock.available' },
        costUSD: { $sum: { $multiply: ['$stock.available', '$pricing.costUSD'] } },
        retailUSD: { $sum: { $multiply: ['$stock.available', '$pricing.priceUSD'] } },
        lowStock: { $sum: { $cond: [{ $lte: ['$stock.available', '$stock.minimum'] }, 1, 0] } }
      }
    }
  ]);

  const cost = round2(result?.costUSD || 0);
  const retail = round2(result?.retailUSD || 0);

  return {
    reportKey: 'inventory-valuation',
    period: period(),
    displayCurrency: currency,
    valuationMode: 'current',
    rateSnapshot: snap,
    summary: {
      products: result?.products || 0,
      units: result?.units || 0,
      cost: convert(cost, currency, snap),
      retail: convert(retail, currency, snap),
      potentialMargin: convert(round2(retail - cost), currency, snap)
    },
    series: [],
    alerts: result?.lowStock
      ? [{ code: 'LOW_STOCK_DETECTED', message: `${result.lowStock} productos bajo stock mínimo.`, severity: 'warning' }]
      : [],
    generatedAt: new Date().toISOString()
  };
}

async function buildProfitabilityReport({ from, to, currency = 'USD' }, rate) {
  const snap = snapshot(rate);
  const rows = await Sale.aggregate([
    { $match: dateMatch(from, to) },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.productId',
        foreignField: '_id',
        as: 'product'
      }
    },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: '$items.name',
        units: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.subtotal.amount' },
        cost: {
          $sum: {
            $multiply: ['$items.quantity', { $ifNull: ['$product.pricing.costUSD', 0] }]
          }
        }
      }
    },
    {
      $addFields: {
        profit: { $subtract: ['$revenue', '$cost'] },
        margin: {
          $cond: [
            { $gt: ['$revenue', 0] },
            { $multiply: [{ $divide: [{ $subtract: ['$revenue', '$cost'] }, '$revenue'] }, 100] },
            0
          ]
        }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: 20 }
  ]);

  return {
    reportKey: 'profitability',
    period: period(from, to),
    displayCurrency: currency,
    rateSnapshot: snap,
    summary: {
      revenue: convert(round2(rows.reduce((acc, r) => acc + r.revenue, 0)), currency, snap),
      profit: convert(round2(rows.reduce((acc, r) => acc + r.profit, 0)), currency, snap)
    },
    series: rows.map((row) => ({
      key: row._id,
      label: row._id,
      metrics: {
        units: row.units,
        revenue: convert(row.revenue, currency, snap),
        cost: convert(row.cost, currency, snap),
        profit: convert(row.profit, currency, snap),
        marginPercent: round2(row.margin)
      }
    })),
    alerts: [],
    generatedAt: new Date().toISOString()
  };
}

async function buildReplenishmentReport({ currency = 'USD' }, rate) {
  const snap = snapshot(rate);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const soldRows = await Sale.aggregate([
    { $match: { status: 'COMPLETED', 'audit.createdAt': { $gte: since } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.productId', units: { $sum: '$items.quantity' } } }
  ]);
  const soldMap = new Map(soldRows.map((row) => [String(row._id), row.units]));
  const products = await Product.find({ 'flags.active': true }).lean();

  const series = products.map((product) => {
    const daily = (soldMap.get(String(product._id)) || 0) / 30;
    const leadTime = 7;
    const reorderPoint = daily * leadTime + product.stock.minimum;
    const coverage = daily > 0 ? round2(product.stock.available / daily) : null;
    const suggested = Math.max(0, Math.ceil(reorderPoint - product.stock.available));
    return {
      key: product.sku,
      label: product.name,
      metrics: {
        available: product.stock.available,
        minimum: product.stock.minimum,
        dailyAverage: round2(daily),
        daysCoverage: coverage,
        suggestedOrder: suggested,
        estimatedCost: convert(round2(suggested * product.pricing.costUSD), currency, snap),
        priority: coverage !== null && coverage < leadTime ? 'CRITICAL' : coverage !== null && coverage < leadTime * 1.5 ? 'HIGH' : 'NORMAL'
      }
    };
  });

  return {
    reportKey: 'replenishment',
    period: period(),
    displayCurrency: currency,
    rateSnapshot: snap,
    summary: {
      productsAnalyzed: series.length,
      criticalItems: series.filter((item) => item.metrics.priority === 'CRITICAL').length,
      estimatedInvestment: convert(
        round2(series.reduce((acc, item) => acc + item.metrics.estimatedCost.amount, 0)),
        currency,
        snap
      )
    },
    series,
    alerts: [],
    generatedAt: new Date().toISOString()
  };
}

const BUILDERS = {
  sales: buildSalesReport,
  iva: buildIvaReport,
  'inventory-valuation': buildInventoryReport,
  profitability: buildProfitabilityReport,
  replenishment: buildReplenishmentReport
};

async function runReport(key, query, rate) {
  const builder = BUILDERS[key];
  if (!builder) {
    throw badRequest('Reporte no disponible.', {
      field: 'reportKey',
      userMessage: 'Ese reporte no está disponible.',
      suggestion: `Opciones: ${Object.keys(BUILDERS).join(', ')}.`
    });
  }
  return builder(query, rate);
}

router.get('/sales', requireAuth, async (req, res, next) => {
  try {
    const rate = await getActiveRate();
    return ok(res, { data: await runReport('sales', req.query, rate) });
  } catch (error) {
    return next(error);
  }
});

router.get('/iva', requireAuth, async (req, res, next) => {
  try {
    const rate = await getActiveRate();
    return ok(res, { data: await runReport('iva', req.query, rate) });
  } catch (error) {
    return next(error);
  }
});

router.get('/inventory-valuation', requireAuth, async (req, res, next) => {
  try {
    const rate = await getActiveRate();
    return ok(res, { data: await runReport('inventory-valuation', req.query, rate) });
  } catch (error) {
    return next(error);
  }
});

router.get('/profitability', requireAuth, async (req, res, next) => {
  try {
    const rate = await getActiveRate();
    return ok(res, { data: await runReport('profitability', req.query, rate) });
  } catch (error) {
    return next(error);
  }
});

router.get('/replenishment', requireAuth, async (req, res, next) => {
  try {
    const rate = await getActiveRate();
    return ok(res, { data: await runReport('replenishment', req.query, rate) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:key/export', requireAuth, async (req, res, next) => {
  try {
    const rate = await getActiveRate();
    const report = await runReport(req.params.key, req.query, rate);
    const format = String(req.query.format || 'pdf').toLowerCase();

    if (format === 'csv') {
      const lines = [
        'seccion,clave,valor',
        ...Object.entries(report.summary || {}).map(([key, value]) =>
          `resumen,${key},${typeof value === 'object' ? value.amount : value ?? ''}`
        ),
        ...report.series.map((row) =>
          `serie,${row.key},${row.metrics.total?.amount ?? row.metrics.profit?.amount ?? ''}`
        )
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${report.reportKey}.csv"`);
      return res.send(lines.join('\n'));
    }

    if (format !== 'pdf') {
      throw badRequest('Formato no soportado.', {
        field: 'format',
        userMessage: 'Selecciona un formato válido.',
        suggestion: 'Opciones: pdf, csv.'
      });
    }

    const lines = [
      `Reporte: ${report.reportKey}`,
      `Período: ${report.period.from} a ${report.period.to}`,
      `Moneda: ${report.displayCurrency}`,
      `Tasa BCV: ${report.rateSnapshot.value} (${report.rateSnapshot.date})`,
      '',
      'Resumen:',
      ...Object.entries(report.summary || {}).map(([key, value]) =>
        `${key}: ${typeof value === 'object' ? value.amount : value}`
      ),
      '',
      'Series:',
      ...report.series.slice(0, 35).map((row) => `${row.label}: ${row.metrics.total?.amount ?? row.metrics.profit?.amount ?? ''}`)
    ];

    const buffer = createSimplePdf(`Reporte ${report.reportKey}`, lines);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.reportKey}.pdf"`);
    return res.send(buffer);
  } catch (error) {
    return next(error);
  }
});

export default router;
