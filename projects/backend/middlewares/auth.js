import jwt from 'jsonwebtoken';
import { forbidden, unauthorized } from '../helpers/errors.js';

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return next(unauthorized());
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || '');
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
