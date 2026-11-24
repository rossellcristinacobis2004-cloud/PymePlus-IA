import { badRequest } from './errors.js';

/** Nombres de pago solicitados para la API pública de facturación. */
export const PAYMENT_METHODS = Object.freeze([
  'Efectivo USD',
  'Pago Móvil',
  'Punto de Venta',
  'Zelle'
]);

/** Nombres internos históricos, conservados por compatibilidad. */
export const LEGACY_PAYMENT_METHODS = Object.freeze([
  'CASH_USD',
  'CASH_VES',
  'CARD',
  'TRANSFER',
  'CREDIT'
]);

const TO_INTERNAL = Object.freeze({
  'Efectivo USD': 'CASH_USD',
  'Pago Móvil': 'TRANSFER',
  'Punto de Venta': 'CARD',
  Zelle: 'TRANSFER'
});

const TO_DISPLAY = Object.freeze({
  CASH_USD: 'Efectivo USD',
  CASH_VES: 'Pago Móvil',
  CARD: 'Punto de Venta',
  TRANSFER: 'Pago Móvil',
  CREDIT: 'Pago Móvil'
});

export function toInternalPaymentMethod(value) {
  return TO_INTERNAL[value] || null;
}

export function toDisplayPaymentMethod(value) {
  return TO_DISPLAY[value] || null;
}

/**
 * Acepta el formato nuevo (`paymentMethod`) y el histórico (`payment.method`).
 * El storage interno sigue usando `payment.method`.
 */
export function resolvePayment(body = {}) {
  const display = String(body.paymentMethod || '').trim();
  const internalFromBody = String(body.payment?.method || '').trim().toUpperCase();

  if (display && PAYMENT_METHODS.includes(display)) {
    return { display, internal: TO_INTERNAL[display] };
  }

  if (internalFromBody && LEGACY_PAYMENT_METHODS.includes(internalFromBody)) {
    return { display: TO_DISPLAY[internalFromBody] || internalFromBody, internal: internalFromBody };
  }

  throw badRequest('Método de pago no soportado.', {
    field: 'paymentMethod',
    userMessage: 'Selecciona un método de pago válido.',
    suggestion: PAYMENT_METHODS.join(', ')
  });
}
