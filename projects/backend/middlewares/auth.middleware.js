import jwt from 'jsonwebtoken';
import { ApiError, forbidden, unauthorized } from '../helpers/errors.js';

/** `ADMIN` es el valor persistido; el literal se acepta por compatibilidad de contrato. */
export const ADMIN_ROLES = Object.freeze(['ADMIN', 'Administrador']);
export const PRICE_FIELDS = Object.freeze([
  'priceUSD',
  'costUSD',
  'manualPriceVES',
  'promotionPriceUSD',
  'pricingMode',
  'priceIncludesTax',
  'taxType',
  'pricing'
]);

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return next(unauthorized());
  }

  // Solo se evalúa cuando sí hay credenciales: evitar 500 a quien no envió token.
  if (!process.env.JWT_SECRET) {
    return next(
      new ApiError(500, 'INTERNAL_ERROR', 'JWT_SECRET no configurado.', {
        userMessage: 'El servidor no está configurado correctamente.',
        suggestion: 'Define JWT_SECRET en el entorno del servidor.'
      })
    );
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type === 'refresh') {
      return next(unauthorized('El token de renovación no es válido para acceder.'));
    }

    req.user = {
      id: payload.sub,
      name: payload.name,
      role: payload.role
    };
    return next();
  } catch {
    return next(unauthorized('Token inválido o expirado.'));
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    return next();
  };
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (!ADMIN_ROLES.includes(req.user.role)) {
    return next(
      forbidden('Solo un administrador puede realizar esta acción.', {
        userMessage: 'Solo un administrador puede realizar esta acción.',
        suggestion: 'Solicita la intervención de un administrador.'
      })
    );
  }
  return next();
}

function hasPriceFields(body) {
  if (!body || typeof body !== 'object') return false;
  return PRICE_FIELDS.some((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) return true;
    if (field === 'pricing' && body.pricing && typeof body.pricing === 'object') {
      return Object.keys(body.pricing).length > 0;
    }
    return false;
  });
}

/** Permite edición no monetaria a otros roles; bloquea cualquier campo de precio. */
export function requirePricePermission(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (!hasPriceFields(req.body)) return next();

  if (!ADMIN_ROLES.includes(req.user.role)) {
    return next(
      forbidden('Solo un administrador puede modificar precios.', {
        userMessage: 'Solo un administrador puede modificar precios.',
        suggestion: 'Pide a un administrador que actualice el precio del producto.'
      })
    );
  }
  return next();
}
