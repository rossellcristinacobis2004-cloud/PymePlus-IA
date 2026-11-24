import ExchangeRate from '../api/exchange-rates/exchange-rate.model.js';
import { rateSnapshot } from '../helpers/money.js';
import { todayCaracas } from '../helpers/response.js';
import { fetchMarketRate, MARKET_RATE_REASON } from './market-rate.provider.js';

const DEFAULT_INTERVAL_MINUTES = 30;

function jobEnabled() {
  if (process.env.MARKET_RATE_ENABLED === 'true') return true;
  if (process.env.MARKET_RATE_ENABLED === 'false') return false;
  // Las suites de pruebas no deben consultar Internet ni escribir en Mongo.
  return process.env.NODE_ENV !== 'test';
}

function intervalMinutes() {
  const configured = Number(process.env.MARKET_RATE_INTERVAL_MINUTES || DEFAULT_INTERVAL_MINUTES);
  return Number.isFinite(configured) && configured >= 1 ? configured : DEFAULT_INTERVAL_MINUTES;
}

/**
 * Persiste la referencia de mercado en el documento activo del día.
 * Se guarda con `source: 'BCV'` (único source que consume getActiveRate()) pero con
 * `isFallback: true` y el motivo real, para no falsificar una tasa oficial.
 * Una tasa confirmada por Finanzas (verifiedBy) nunca se sobrescribe.
 */
export async function applyMarketRate(
  rate,
  { model = ExchangeRate, io = null, date = todayCaracas(), now = new Date() } = {}
) {
  const existing = await model.findOne({ date, source: 'BCV' }).lean();
  if (existing?.verifiedBy && !existing.isFallback) {
    return {
      applied: false,
      reason: 'OFFICIAL_RATE_PRESERVED',
      rate: existing,
      snapshot: { ...rateSnapshot(existing), reason: existing.reason || null }
    };
  }

  const doc = await model.findOneAndUpdate(
    { date, source: 'BCV' },
    {
      $set: {
        value: rate.value,
        status: 'ACTIVE',
        isFallback: true,
        reason: MARKET_RATE_REASON,
        verifiedBy: null,
        capturedAt: now,
        sourceUpdatedAt: rate.sourceUpdatedAt ? new Date(rate.sourceUpdatedAt) : null
      }
    },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true }
  );

  const snapshot = {
    ...rateSnapshot(doc),
    reason: doc.reason || MARKET_RATE_REASON,
    sourceUpdatedAt: rate.sourceUpdatedAt || null
  };
  io?.to('authenticated').emit('exchangeRate:updated', snapshot);

  return { applied: true, rate: doc, snapshot };
}

/** Job de mercado: ejecución inicial y refresco periódico (30 min por defecto). */
export class MarketRateJob {
  constructor({
    fetchRate = fetchMarketRate,
    persist = applyMarketRate,
    io = null,
    enabled = jobEnabled(),
    minutes = intervalMinutes(),
    fetchOptions = {},
    persistOptions = {}
  } = {}) {
    this.fetchRate = fetchRate;
    this.persist = persist;
    this.io = io;
    this.enabled = enabled;
    this.intervalMs = Math.max(1, Number(minutes)) * 60_000;
    this.fetchOptions = fetchOptions;
    this.persistOptions = persistOptions;
    this.timer = null;
  }

  start() {
    if (!this.enabled) return;
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  async tick() {
    try {
      const marketRate = await this.fetchRate(this.fetchOptions);
      const result = await this.persist(marketRate, { io: this.io, ...this.persistOptions });
      if (result.applied) {
        console.info(`[TASA] Referencia de mercado actualizada: ${marketRate.value} (${marketRate.date}).`);
      } else {
        console.info('[TASA] Se conservó la tasa confirmada por Finanzas.');
      }
      return result;
    } catch (error) {
      // Degradación elegante: se mantiene el último valor válido marcado como fallback.
      console.warn('[TASA] No se pudo actualizar la referencia de mercado:', error?.message || error);
      return null;
    }
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

export function createMarketRateJob(options = {}) {
  return new MarketRateJob(options);
}
