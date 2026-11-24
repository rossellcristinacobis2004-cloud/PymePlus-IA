import { round4 } from '../helpers/money.js';

/** La fuente es referencia de mercado, NO la tasa oficial del BCV (BR-25). */
export const MARKET_RATE_REASON = 'Referencia de mercado (exchangerate-api)';
export const DEFAULT_MARKET_RATE_URL = 'https://open.er-api.com/v6/latest/USD';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_AGE_HOURS = 48;
const DEFAULT_ATTEMPTS = 2;
const CARACAS_OFFSET_MS = 4 * 60 * 60 * 1000;

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function caracasDate(now) {
  return new Date(now.getTime() - CARACAS_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Valida y normaliza la respuesta pública de exchangerate-api (v6).
 * La fecha guardada es la de Caracas para que getActiveRate() priorice el día vigente;
 * `sourceUpdatedAt` conserva el instante real de actualización del proveedor.
 */
export function parseMarketRate(payload, { now = new Date(), maxAgeHours = DEFAULT_MAX_AGE_HOURS } = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('La respuesta del proveedor de tasa no es válida.');
  }
  if (payload.result && payload.result !== 'success') {
    throw new Error('El proveedor de tasa no pudo devolver una cotización.');
  }

  const value = positive(payload.rates?.VES);
  if (!value) {
    throw new Error('El proveedor de tasa no devolvió un valor VES válido.');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('La fecha de referencia no es válida.');
  }

  const rawTime = payload.time_last_update_unix
    ? Number(payload.time_last_update_unix) * 1000
    : payload.time_last_update_utc
      ? new Date(payload.time_last_update_utc).getTime()
      : null;

  if (rawTime !== null && Number.isFinite(rawTime) && now.getTime() - rawTime > maxAgeHours * 3_600_000) {
    throw new Error('La cotización del proveedor está desactualizada.');
  }

  const sourceUpdatedAt =
    rawTime !== null && Number.isFinite(rawTime) ? new Date(rawTime).toISOString() : now.toISOString();

  return {
    value: round4(value),
    date: caracasDate(now),
    sourceUpdatedAt,
    fetchedAt: now.toISOString()
  };
}

/** Consulta la API pública sin clave. `fetchImpl` permite inyectar un cliente en pruebas. */
export async function fetchMarketRate({
  url = process.env.MARKET_RATE_URL || DEFAULT_MARKET_RATE_URL,
  timeoutMs = Number(process.env.MARKET_RATE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  maxAgeHours = Number(process.env.MARKET_RATE_MAX_AGE_HOURS || DEFAULT_MAX_AGE_HOURS),
  attempts = DEFAULT_ATTEMPTS,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No hay cliente HTTP disponible para consultar la tasa.');
  }

  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`El proveedor de tasa respondió HTTP ${response.status}.`);
      }
      return parseMarketRate(await response.json(), { maxAgeHours });
    } catch (error) {
      lastError = error?.name === 'AbortError'
        ? new Error(`Tiempo de espera agotado al consultar la tasa (${timeoutMs} ms).`)
        : error;
      if (attempt < Math.max(1, attempts)) continue;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
