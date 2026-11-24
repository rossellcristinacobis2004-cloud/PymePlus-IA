import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from './user.model.js';
import { requireAuth } from '../../middlewares/auth.js';
import { ok } from '../../helpers/response.js';
import { ApiError, badRequest, unauthorized } from '../../helpers/errors.js';
import { validateEmail, requireString } from '../../helpers/validators.js';

const router = Router();

router.post('/login', async (req, res, next) => {
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

    const token = jwt.sign(
      { sub: user.id, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    return ok(res, {
      data: { token, tokenType: 'Bearer', expiresIn: process.env.JWT_EXPIRES_IN || '8h', user: user.toSafeObject() },
      message: 'Inicio de sesión exitoso.'
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', requireAuth, (req, res) =>
  ok(res, { data: req.user, message: 'Usuario autenticado.' })
);

export default router;
