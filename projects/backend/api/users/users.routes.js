import { Router } from 'express';
import mongoose from 'mongoose';

import User, { USER_ROLES } from '../auth/user.model.js';
import { requireAuth, requireRole, clearAuthCache } from '../../middlewares/auth.js';
import { ok, created, paginate } from '../../helpers/response.js';
import { badRequest, notFound, conflict } from '../../helpers/errors.js';
import { validateEmail, requireString, positiveInt } from '../../helpers/validators.js';

const router = Router();

/** Nunca se devuelve el hash: la única representación pública es toSafeObject(). */
function serializeUser(user) {
  const safe = typeof user.toSafeObject === 'function' ? user.toSafeObject() : user;
  return {
    ...safe,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null
  };
}

function validateUserBody(body, partial = false) {
  const payload = {};

  if (!partial || body.name !== undefined) {
    payload.name = requireString(body.name, 'name', { min: 2, max: 100 });
  }
  if (!partial || body.email !== undefined) {
    payload.email = validateEmail(body.email);
  }
  if (!partial || body.password !== undefined) {
    // bcrypt aplica el hash en el hook pre('save') del modelo.
    payload.password = requireString(body.password, 'password', { min: 8, max: 100 });
  }
  if (!partial || body.role !== undefined) {
    const role = String(body.role || '').trim().toUpperCase() === 'ADMINISTRADOR'
      ? 'ADMIN'
      : String(body.role || '').trim().toUpperCase();
    if (!USER_ROLES.includes(role)) {
      throw badRequest('Rol no válido.', {
        field: 'role',
        userMessage: 'Selecciona un rol válido.',
        suggestion: `Opciones: ${USER_ROLES.join(', ')}.`
      });
    }
    payload.role = role;
  }
  if (body.active !== undefined) payload.active = Boolean(body.active);

  return payload;
}

/** Evita auto-bloquear la sesión y dejar el sistema sin administradores activos. */
async function assertSafeUserChange(req, user, payload) {
  const isSelf = String(user._id) === String(req.user.id);
  const nextRole = payload.role ?? user.role;
  const nextActive = payload.active ?? user.active;

  if (isSelf && (nextRole !== 'ADMIN' || nextActive === false)) {
    throw badRequest('No puedes cambiar tu propio rol ni darte de baja.', {
      field: isSelf && nextActive === false ? 'active' : 'role',
      userMessage: 'Un administrador no puede desactivarse ni quitarse el rol a sí mismo.',
      suggestion: 'Pide a otro administrador que realice el cambio.'
    });
  }

  const wasActiveAdmin = user.role === 'ADMIN' && user.active;
  const willBeActiveAdmin = nextRole === 'ADMIN' && nextActive;
  if (wasActiveAdmin && !willBeActiveAdmin) {
    const otherAdmins = await User.countDocuments({
      role: 'ADMIN',
      active: true,
      _id: { $ne: user._id }
    });
    if (otherAdmins === 0) {
      throw conflict('LAST_ADMIN', 'Debe quedar al menos un administrador activo.', {
        userMessage: 'No se puede dar de baja al último administrador activo.',
        suggestion: 'Crea otro administrador antes de realizar este cambio.'
      });
    }
  }
}

router.get('/', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.role) {
      const role = String(req.query.role).toUpperCase() === 'ADMINISTRADOR'
        ? 'ADMIN'
        : String(req.query.role).toUpperCase();
      if (!USER_ROLES.includes(role)) {
        throw badRequest('Rol no válido.', { field: 'role', userMessage: 'Selecciona un rol válido.' });
      }
      filter.role = role;
    }
    if (req.query.active !== undefined) filter.active = req.query.active === 'true';
    if (req.query.search) {
      const term = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } }
      ];
    }

    const page = positiveInt(req.query.page, 'page', 1);
    const limit = positiveInt(req.query.limit, 'limit', 50);
    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .sort({ createdAt: -1, name: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return ok(res, {
      data: users.map(serializeUser),
      meta: { pagination: paginate({ page, limit, total }) }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const payload = validateUserBody(req.body || {});
    const user = await User.create(payload);
    return created(res, serializeUser(user), 'Usuario creado correctamente.');
  } catch (error) {
    if (error.code === 11000) {
      return next(conflict('DUPLICATE_KEY', 'Correo ya registrado.', {
        field: 'email',
        userMessage: 'Ya existe un usuario con ese correo.',
        suggestion: 'Usa otro correo o edita el usuario existente.'
      }));
    }
    return next(error);
  }
});

router.patch('/:id', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Usuario');
    const payload = validateUserBody(req.body || {}, true);
    if (Object.keys(payload).length === 0) {
      throw badRequest('No se enviaron cambios.', {
        userMessage: 'No hay datos para actualizar.',
        suggestion: 'Revisa el formulario e inténtalo de nuevo.'
      });
    }

    const query = User.findById(req.params.id);
    if (payload.password !== undefined) query.select('+password');
    const user = await query;
    if (!user) throw notFound('Usuario');

    await assertSafeUserChange(req, user, payload);
    Object.assign(user, payload);
    await user.save();

    // El rol/estado se revalida en DB con caché de 30 s: se invalida al cambiar.
    clearAuthCache();

    return ok(res, { data: serializeUser(user), message: 'Usuario actualizado correctamente.' });
  } catch (error) {
    if (error.code === 11000) {
      return next(conflict('DUPLICATE_KEY', 'Correo ya registrado.', {
        field: 'email',
        userMessage: 'Ya existe un usuario con ese correo.',
        suggestion: 'Usa otro correo o edita el usuario existente.'
      }));
    }
    return next(error);
  }
});

/** Baja lógica: conserva el histórico de auditoría de la venta. */
router.delete('/:id', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Usuario');
    const user = await User.findById(req.params.id);
    if (!user) throw notFound('Usuario');

    await assertSafeUserChange(req, user, { active: false });
    user.active = false;
    await user.save();
    clearAuthCache();

    return ok(res, { data: serializeUser(user), message: 'Usuario dado de baja correctamente.' });
  } catch (error) {
    return next(error);
  }
});

export default router;
