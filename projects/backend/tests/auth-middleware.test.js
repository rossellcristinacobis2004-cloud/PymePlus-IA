import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import {
  ADMIN_ROLES,
  requireAdmin,
  requireAuth,
  requirePricePermission,
  requireRole
} from '../middlewares/auth.middleware.js';

process.env.JWT_SECRET = 'middleware-test-secret';

function invoke(middleware, req) {
  return new Promise((resolve) => middleware(req, {}, (error) => resolve(error)));
}

function bearer(payload, secret = process.env.JWT_SECRET) {
  return { headers: { authorization: `Bearer ${jwt.sign(payload, secret)}` } };
}

test('requireAuth acepta un access token válido', async () => {
  const req = bearer({ sub: 'usr-1', name: 'Administrador', role: 'ADMIN' });
  const error = await invoke(requireAuth, req);
  assert.equal(error, undefined);
  assert.deepEqual(req.user, { id: 'usr-1', name: 'Administrador', role: 'ADMIN' });
});

test('requireAuth rechaza ausencia de token y refresh tokens', async () => {
  const missing = await invoke(requireAuth, { headers: {} });
  assert.equal(missing.status, 401);

  const refresh = await invoke(
    requireAuth,
    bearer({ sub: 'usr-1', type: 'refresh' })
  );
  assert.equal(refresh.status, 401);
});

test('requireAuth falla con 500 si JWT_SECRET no está configurado', async () => {
  const previous = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    const error = await invoke(requireAuth, bearer({ sub: 'usr-1' }, 'otro-secreto'));
    assert.equal(error.status, 500);
    assert.equal(error.code, 'INTERNAL_ERROR');
  } finally {
    process.env.JWT_SECRET = previous;
  }
});

test('requireAuth rechaza tokens firmados con otro algoritmo', async () => {
  const token = jwt.sign({ sub: 'usr-1', role: 'ADMIN' }, process.env.JWT_SECRET, {
    algorithm: 'HS384'
  });
  const error = await invoke(requireAuth, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(error.status, 401);
});

test('requireAuth normaliza el alias Administrador para todas las rutas', async () => {
  const req = bearer({ sub: 'usr-2', role: 'Administrador' });
  assert.equal(await invoke(requireAuth, req), undefined);
  assert.equal(req.user.role, 'ADMIN');
  assert.equal(await invoke(requireRole('ADMIN'), req), undefined);
});

test('requireAdmin acepta ADMIN y el alias Administrador', async () => {
  assert.deepEqual([...ADMIN_ROLES], ['ADMIN', 'Administrador']);

  const admin = await invoke(requireAdmin, { user: { role: 'ADMIN' } });
  assert.equal(admin, undefined);

  const alias = await invoke(requireAdmin, { user: { role: 'Administrador' } });
  assert.equal(alias, undefined);

  const warehouse = await invoke(requireAdmin, { user: { role: 'WAREHOUSE' } });
  assert.equal(warehouse.status, 403);
});

test('requireRole conserva la comprobación histórica', async () => {
  const allowed = await invoke(requireRole('ADMIN', 'WAREHOUSE'), { user: { role: 'WAREHOUSE' } });
  assert.equal(allowed, undefined);

  const denied = await invoke(requireRole('ADMIN'), { user: { role: 'CASHIER' } });
  assert.equal(denied.status, 403);
});

test('requirePricePermission solo bloquea campos de precio para no administradores', async () => {
  const warehouse = { user: { role: 'WAREHOUSE' }, body: { name: 'Producto', stock: 5 } };
  assert.equal(await invoke(requirePricePermission, warehouse), undefined);

  warehouse.body.priceUSD = 10;
  const denied = await invoke(requirePricePermission, warehouse);
  assert.equal(denied.status, 403);
  assert.match(denied.userMessage, /administrador/i);

  warehouse.body = { pricing: { priceUSD: 10 } };
  assert.equal((await invoke(requirePricePermission, warehouse)).status, 403);

  const admin = { user: { role: 'ADMIN' }, body: { priceUSD: 10, costUSD: 6 } };
  assert.equal(await invoke(requirePricePermission, admin), undefined);
});
