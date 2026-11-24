import rateLimit from 'express-rate-limit';

/**
 * Limitadores por IP. En pruebas (NODE_ENV=test) se desactivan para no
 * interferir con las suites que realizan muchas peticiones secuenciales.
 */
function disabled() {
  return process.env.NODE_ENV === 'test';
}

export const loginLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || 900_000),
  limit: Number(process.env.RATE_LIMIT_LOGIN_MAX || 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Demasiados intentos de inicio de sesión.',
    userMessage: 'Has intentado iniciar sesión demasiadas veces. Espera unos minutos.',
    data: null,
    meta: { timestamp: new Date().toISOString() },
    errors: [
      {
        code: 'RATE_LIMIT_EXCEEDED',
        field: null,
        detail: 'Límite de intentos de acceso excedido.',
        suggestion: 'Espera unos minutos antes de volver a intentarlo.',
        retryable: true
      }
    ]
  },
  skip: () => disabled()
});

export const salesLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_SALES_WINDOW_MS || 60_000),
  limit: Number(process.env.RATE_LIMIT_SALES_MAX || 60),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Demasiadas operaciones de venta.',
    userMessage: 'Estás registrando ventas demasiado rápido. Espera un momento.',
    data: null,
    meta: { timestamp: new Date().toISOString() },
    errors: [
      {
        code: 'RATE_LIMIT_EXCEEDED',
        field: null,
        detail: 'Límite de operaciones de venta excedido.',
        suggestion: 'Espera unos segundos antes de continuar.',
        retryable: true
      }
    ]
  },
  skip: () => disabled()
});
