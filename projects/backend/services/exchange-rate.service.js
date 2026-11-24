import ExchangeRate from '../api/exchange-rates/exchange-rate.model.js';
import { conflict } from '../helpers/errors.js';
import { rateSnapshot } from '../helpers/money.js';
import { todayCaracas } from '../helpers/response.js';

const MAX_AGE_HOURS = Number(process.env.RATE_MAX_AGE_HOURS || 48);
const EXPIRED_HOURS = 72;

/** Devuelve la tasa BCV vigente o un fallback explícitamente marcado. */
export async function getActiveRate() {
  let rate = await ExchangeRate.findOne({ status: 'ACTIVE', source: 'BCV' })
    .sort({ date: -1, capturedAt: -1 })
    .lean();

  if (!rate) {
    const fallback = Number(process.env.FALLBACK_BCV_RATE || 0);
    if (!fallback) {
      throw conflict(
        'EXCHANGE_RATE_EXPIRED',
        'No hay tasa BCV vigente configurada.',
        {
          userMessage: 'No se puede facturar hasta actualizar la tasa BCV.',
          suggestion: 'Configura FALLBACK_BCV_RATE o carga una tasa oficial en el sistema.'
        }
      );
    }

    rate = {
      value: fallback,
      source: 'BCV',
      date: todayCaracas(),
      capturedAt: new Date(),
      status: 'ACTIVE',
      isFallback: true
    };
  }

  return rate;
}

export function ageHours(rate) {
  return (Date.now() - new Date(rate.capturedAt).getTime()) / 3_600_000;
}

/** Bloquea cobros en VES cuando la tasa está fuera de tolerancia. */
export function assertCurrencyAllowed(rate, currency = 'USD') {
  const hours = ageHours(rate);

  if (hours > EXPIRED_HOURS || rate.status === 'EXPIRED') {
    throw conflict('EXCHANGE_RATE_EXPIRED', 'La tasa BCV está expirada.', {
      userMessage: 'No se puede facturar hasta actualizar la tasa BCV.',
      suggestion: 'Actualiza la tasa oficial e inténtalo de nuevo.'
    });
  }

  if (currency === 'VES' && (hours > MAX_AGE_HOURS || rate.status === 'STALE')) {
    throw conflict('STALE_EXCHANGE_RATE', 'La tasa BCV está desactualizada.', {
      userMessage: 'La tasa BCV está desactualizada. Puedes cobrar en USD o esperar la actualización.',
      suggestion: 'Cobra en USD o solicita a Finanzas la actualización de la tasa.',
      field: 'currency'
    });
  }
}

export function snapshot(rate) {
  return rateSnapshot(rate);
}
