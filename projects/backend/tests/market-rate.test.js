import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MARKET_RATE_URL,
  MARKET_RATE_REASON,
  fetchMarketRate,
  parseMarketRate
} from '../services/market-rate.provider.js';
import { MarketRateJob, applyMarketRate } from '../services/market-rate.job.js';

const NOW = new Date('2026-11-24T05:20:00.000Z');
const UPDATED_UNIX = 1795478551; // 2026-11-24T00:02:31Z

function payload(overrides = {}) {
  return {
    result: 'success',
    base_code: 'USD',
    time_last_update_unix: UPDATED_UNIX,
    rates: { USD: 1, VES: 919.8227, ...overrides.rates },
    ...overrides.rest
  };
}

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test('parseMarketRate normaliza la cotización y conserva la fecha de la fuente', () => {
  const parsed = parseMarketRate(payload(), { now: NOW });
  assert.equal(parsed.value, 919.8227);
  assert.equal(parsed.date, '2026-11-24');
  assert.equal(parsed.sourceUpdatedAt, new Date(UPDATED_UNIX * 1000).toISOString());
  assert.equal(parsed.fetchedAt, NOW.toISOString());
});

test('parseMarketRate rechaza respuestas sin VES válido', () => {
  assert.throws(() => parseMarketRate(payload({ rates: { VES: undefined } }), { now: NOW }), /VES/);
  assert.throws(() => parseMarketRate(payload({ rates: { VES: -1 } }), { now: NOW }), /VES/);
  assert.throws(() => parseMarketRate({ result: 'error' }, { now: NOW }), /cotización/);
});

test('parseMarketRate rechaza cotizaciones desactualizadas', () => {
  const old = { ...payload(), time_last_update_unix: (NOW.getTime() - 100 * 3_600_000) / 1000 };
  assert.throws(() => parseMarketRate(old, { now: NOW, maxAgeHours: 48 }), /desactualizada/);
});

test('fetchMarketRate reintenta ante fallos HTTP y no expone credenciales', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return calls.length === 1 ? response({ message: 'temporary' }, false, 503) : response(payload());
  };

  const result = await fetchMarketRate({ fetchImpl, attempts: 2 });
  assert.equal(result.value, 919.8227);
  assert.deepEqual(calls, [DEFAULT_MARKET_RATE_URL, DEFAULT_MARKET_RATE_URL]);
});

test('applyMarketRate guarda la referencia como fallback y avisa por socket', async () => {
  const saved = {
    value: 919.8227,
    source: 'BCV',
    date: '2026-11-24',
    capturedAt: NOW,
    status: 'ACTIVE',
    isFallback: true,
    reason: MARKET_RATE_REASON
  };
  let updateArgs;
  const model = {
    findOne: () => ({ lean: async () => ({ value: 36, isFallback: false, verifiedBy: null }) }),
    findOneAndUpdate: async (...args) => {
      updateArgs = args;
      return saved;
    }
  };
  const emitted = [];
  const io = { to: () => ({ emit: (event, data) => emitted.push([event, data]) }) };

  const result = await applyMarketRate(
    { value: 919.8227, sourceUpdatedAt: new Date(UPDATED_UNIX * 1000).toISOString() },
    { model, io, date: '2026-11-24', now: NOW }
  );

  assert.equal(result.applied, true);
  assert.equal(updateArgs[0].source, 'BCV');
  assert.equal(updateArgs[1].$set.isFallback, true);
  assert.equal(updateArgs[1].$set.reason, MARKET_RATE_REASON);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][0], 'exchangeRate:updated');
  assert.equal(emitted[0][1].value, 919.8227);
  assert.match(emitted[0][1].reason, /Referencia de mercado/);
});

test('applyMarketRate no sobrescribe una tasa confirmada por Finanzas', async () => {
  const official = { value: 40, source: 'BCV', isFallback: false, verifiedBy: 'finance-1' };
  let updates = 0;
  const model = {
    findOne: () => ({ lean: async () => official }),
    findOneAndUpdate: async () => {
      updates += 1;
      return official;
    }
  };

  const result = await applyMarketRate({ value: 919.8227 }, { model, date: '2026-11-24', now: NOW });
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'OFFICIAL_RATE_PRESERVED');
  assert.equal(updates, 0);
});

test('MarketRateJob conserva el último valor si falla el proveedor', async () => {
  const job = new MarketRateJob({
    fetchRate: async () => {
      throw new Error('sin conexión');
    },
    persist: async () => {
      throw new Error('no se debe persistir');
    },
    enabled: true
  });

  assert.equal(await job.tick(), null);
  assert.equal(job.timer, null);
});

test('MarketRateJob publica la tasa al arrancar y puede detenerse', async () => {
  const seen = [];
  const job = new MarketRateJob({
    fetchRate: async () => ({ value: 919.8227, date: '2026-11-24' }),
    persist: async (rate) => {
      seen.push(rate.value);
      return { applied: true };
    },
    enabled: true,
    minutes: 30
  });

  job.start();
  // tick() es asíncrono: se espera directamente para no depender de timers.
  await job.tick();
  assert.deepEqual(seen, [919.8227, 919.8227]);
  assert.ok(job.timer);
  job.stop();
  assert.equal(job.timer, null);
});
