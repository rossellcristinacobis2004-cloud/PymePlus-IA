import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

import User from '../api/auth/user.model.js';
import { ApiError, forbidden, unauthorized } from '../helpers/errors.js';

/** `ADMIN` es el valor persistido; el literal se acepta por compatibilidad de contrato. */
export const ADMIN_ROLES = Object.freeze(['ADMIN', 'Administrador']);

/** Unifica roles entrantes para que requireRole('ADMIN') también acepte el alias. */
export function normalizeRole(role) {
  return role === 'Administrador' ? 'ADMIN' : role;
}
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

// Un usuario degradado o desactivado no debe conservar permisos hasta que expire
// el JWT. Se revalida en DB con una caché muy corta; sin DB conectada se confía
// en el token (smoke tests y arranque sin MongoDB).
const revalidationCache = new Map();
const REVALIDATE_TTL_MS = Number(process.env.AUTH_REVALIDATE_TTL_MS || 30_000);

export function clearAuthCache() {
  revalidationCache.clear();
}

async function revalidate(payload) {
  if (mongoose.connection.readyState !== 1 || !payload.sub) return null;
  const id = String(payload.sub);
  const cached = revalidationCache.get(id);
  if (cached && Date.now() - cached.at < REVALIDATE_TTL_MS) return cached.value;

  const user = await User.findById(id).select('role active').lean();
  const value = user
    ? { role: normalizeRole(user.role), active: Boolean(user.active) }
    : { active: false };
  revalidationCache.set(id, { value, at: Date.now() });
  return value;
}

export async function requireAuth(req, _res, next) {
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
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.type === 'refresh') {
      return next(unauthorized('El token de renovación no es válido para acceder.'));
    }

    const current = await revalidate(payload);
    if (current && !current.active) {
      return next(unauthorized('El usuario no está activo.'));
    }

    req.user = {
      id: payload.sub,
      name: payload.name,
      role: current?.role || normalizeRole(payload.role)
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
