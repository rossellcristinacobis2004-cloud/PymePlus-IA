import rateLimit from 'express-rate-limit';

/**
 * Limitadores por IP. En pruebas (NODE_ENV=test) se desactivan para no
 * interferir con las suites que realizan muchas peticiones secuenciales.
 */
function disabled() {
  return process.env.NODE_ENV === 'test';
}

function message(code, message, suggestion) {
  return {
    success: false,
    message,
    userMessage: message,
    data: null,
    meta: { timestamp: new Date().toISOString() },
    errors: [
      {
        code,
        field: null,
        detail: message,
        suggestion,
        retryable: true
      }
    ]
  };
}

export const loginLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || 900_000),
  limit: Number(process.env.RATE_LIMIT_LOGIN_MAX || 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message(
    'RATE_LIMIT_EXCEEDED',
    'Demasiados intentos de inicio de sesión.',
    'Espera unos minutos antes de volver a intentarlo.'
  ),
  skip: () => disabled()
});

export const salesLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_SALES_WINDOW_MS || 60_000),
  limit: Number(process.env.RATE_LIMIT_SALES_MAX || 60),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message(
    'RATE_LIMIT_EXCEEDED',
    'Demasiadas operaciones de venta.',
    'Espera unos segundos antes de continuar.'
  ),
  skip: () => disabled()
});

/** Limitadores para endpoints de autenticación sensibles. */
function authLimiter({ name, limit, windowMs, text, suggestion }) {
  return rateLimit({
    windowMs: Number(process.env[`RATE_LIMIT_${name}_WINDOW_MS`] || windowMs),
    limit: Number(process.env[`RATE_LIMIT_${name}_MAX`] || limit),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: message('RATE_LIMIT_EXCEEDED', text, suggestion),
    skip: () => disabled()
  });
}

export const refreshLimiter = authLimiter({
  name: 'REFRESH',
  limit: 30,
  windowMs: 900_000,
  text: 'Demasiadas renovaciones de sesión.',
  suggestion: 'Espera unos minutos antes de volver a intentarlo.'
});

export const forgotPasswordLimiter = authLimiter({
  name: 'FORGOT_PASSWORD',
  limit: 5,
  windowMs: 3_600_000,
  text: 'Demasiadas solicitudes de recuperación.',
  suggestion: 'Espera una hora antes de solicitar otro enlace.'
});

export const resetPasswordLimiter = authLimiter({
  name: 'RESET_PASSWORD',
  limit: 10,
  windowMs: 3_600_000,
  text: 'Demasiados intentos de restablecer la contraseña.',
  suggestion: 'Espera una hora antes de volver a intentarlo.'
});
