import crypto from 'crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from './user.model.js';
import RefreshToken from './refresh-token.model.js';
import { requireAuth } from '../../middlewares/auth.js';
import {
  loginLimiter,
  refreshLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter
} from '../../middlewares/rate-limit.js';
import { ok, nowIso } from '../../helpers/response.js';
import { ApiError, badRequest, unauthorized } from '../../helpers/errors.js';
import { validateEmail, requireString } from '../../helpers/validators.js';
import { sendInvoice } from '../../microservices/email.connector.js';

const router = Router();

// Los tokens de recuperación se guardan en memoria: son de un solo uso y
// expiran en 30 min. No se persisten datos sensibles en la base de datos.
const resetTokens = new Map();
const REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET || `${process.env.JWT_SECRET || ''}-refresh`;

function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.id, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Los tokens de recuperación viven en memoria: se podan para no crecer sin límite. */
function pruneResetTokens() {
  const now = Date.now();
  for (const [key, entry] of resetTokens) {
    if (entry.expiresAt < now) resetTokens.delete(key);
  }
  if (resetTokens.size > 10_000) {
    for (const key of [...resetTokens.keys()].slice(0, resetTokens.size - 10_000)) {
      resetTokens.delete(key);
    }
  }
}

function issueRefreshToken(user) {
  const token = jwt.sign({ sub: user.id, type: 'refresh', jti: crypto.randomUUID() }, REFRESH_SECRET(), {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  });
  const expiresAt = new Date((jwt.decode(token).exp || 0) * 1000);
  return { token, expiresAt };
}

async function persistRefreshToken(user, refreshToken, req) {
  await RefreshToken.create({
    userId: user.id,
    tokenHash: hashToken(refreshToken.token),
    expiresAt: refreshToken.expiresAt,
    userAgent: req.headers['user-agent'] || null
  });
}

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = validateEmail(req.body?.email);
    const password = requireString(req.body?.password, 'password', { min: 6, max: 100 });

    if (!process.env.JWT_SECRET) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'JWT_SECRET no configurado.', {
        userMessage: 'El servidor no está configurado correctamente.',
        suggestion: 'Define JWT_SECRET en el archivo .env.'
      });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.active || !(await user.comparePassword(password))) {
      throw unauthorized('Correo o contraseña incorrectos.');
    }

    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    const token = issueAccessToken(user);
    const refreshToken = issueRefreshToken(user);
    await persistRefreshToken(user, refreshToken, req);

    return ok(res, {
      data: {
        token,
        refreshToken: refreshToken.token,
        tokenType: 'Bearer',
        expiresIn: process.env.JWT_EXPIRES_IN || '8h',
        user: user.toSafeObject()
      },
      message: 'Inicio de sesión exitoso.'
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/refresh', refreshLimiter, async (req, res, next) => {
  try {
    const token = String(req.body?.refreshToken || '').trim();
    if (!token) throw badRequest('Se requiere refreshToken.', { field: 'refreshToken' });

    let payload;
    try {
      payload = jwt.verify(token, REFRESH_SECRET(), { algorithms: ['HS256'] });
    } catch {
      throw unauthorized('Refresh token inválido o expirado.');
    }
    if (payload.type !== 'refresh') throw unauthorized('Token no válido para renovación.');

    const stored = await RefreshToken.findOne({
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    });
    if (!stored) throw unauthorized('Refresh token revocado o expirado.');

    const user = await User.findById(payload.sub);
    if (!user || !user.active) throw unauthorized('Usuario no disponible.');

    const refreshToken = issueRefreshToken(user);
    stored.revokedAt = new Date();
    await stored.save();
    await persistRefreshToken(user, refreshToken, req);

    return ok(res, {
      data: {
        token: issueAccessToken(user),
        refreshToken: refreshToken.token,
        tokenType: 'Bearer',
        expiresIn: process.env.JWT_EXPIRES_IN || '8h',
        user: user.toSafeObject()
      },
      message: 'Sesión renovada correctamente.'
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
  try {
    const email = validateEmail(req.body?.email);
    pruneResetTokens();
    const user = await User.findOne({ email, active: true });

    // Siempre responde lo mismo para no revelar qué correos están registrados.
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      resetTokens.set(hashToken(token), { userId: user.id, expiresAt: Date.now() + 30 * 60_000 });
      const baseUrl = process.env.PASSWORD_RESET_URL || 'http://localhost:4200/reset-password';
      const link = `${baseUrl}?token=${encodeURIComponent(token)}`;
      const result = await sendInvoice({
        to: email,
        subject: 'Restablece tu contraseña de PymePlus IA',
        fileName: 'reset-password.txt',
        pdfBuffer: Buffer.from(`Usa este enlace para restablecer tu contraseña:\n${link}\n\nCaduca en 30 minutos.`, 'utf8')
      });
      console.log('[AUTH]', JSON.stringify({ event: 'password_reset', channel: result.channel, timestamp: nowIso() }));
    }

    return ok(res, {
      message: 'Si el correo está registrado, recibirás un enlace para restablecer la contraseña.'
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/reset-password', resetPasswordLimiter, async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = requireString(req.body?.password, 'password', { min: 8, max: 100 });
    pruneResetTokens();
    const tokenKey = hashToken(token);
    const entry = resetTokens.get(tokenKey);

    if (!entry || entry.expiresAt < Date.now()) {
      resetTokens.delete(tokenKey);
      throw badRequest('El enlace de recuperación no es válido o expiró.', {
        field: 'token',
        userMessage: 'El enlace de recuperación ya no está disponible.',
        suggestion: 'Solicita un nuevo enlace de recuperación.'
      });
    }

    const user = await User.findById(entry.userId).select('+password');
    if (!user || !user.active) throw unauthorized('Usuario no disponible.');

    user.password = password;
    await user.save();
    resetTokens.delete(tokenKey);

    return ok(res, { message: 'Contraseña actualizada correctamente. Inicia sesión para continuar.' });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', requireAuth, (req, res) =>
  ok(res, { data: req.user, message: 'Usuario autenticado.' })
);

export default router;
