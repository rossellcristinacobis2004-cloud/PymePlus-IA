/**
 * Redondeo HALF_UP (alejado de cero) mediante desplazamiento exponencial.
 * Evita el error de coma flotante de `Math.round(1.005 * 100)`.
 */
function roundTo(value, digits) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const sign = number < 0 ? -1 : 1;
  const shifted = Number(`${Math.abs(number)}e${digits}`);
  return sign * Number(`${Math.round(shifted)}e-${digits}`);
}

export function round2(value) {
  return roundTo(value, 2);
}

export function round4(value) {
  return roundTo(value, 4);
}

export function toVes(usdAmount, rateValue) {
  return round2(Number(usdAmount) * Number(rateValue));
}

/** Construye un objeto Money según el contrato de api_contracts.md. */
export function money(amount, currency = 'USD', rateUsed = null) {
  return {
    amount: round2(amount),
    currency,
    rateUsed: currency === 'VES' ? rateUsed : null
  };
}

export function rateSnapshot(rate) {
  return {
    value: round4(rate.value),
    source: rate.source || 'BCV',
    date: rate.date,
    capturedAt: rate.capturedAt,
    isFallback: Boolean(rate.isFallback)
  };
}
