import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.JWT_SECRET = 'integration-test-secret';
process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.FALLBACK_BCV_RATE = '36';

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGO_URI = replSet.getUri();

const { default: WebServer } = await import('../bin/server.js');
const { default: User } = await import('../api/auth/user.model.js');
const { default: Product } = await import('../api/products/product.model.js');

const server = new WebServer();
server.listen();
await new Promise((resolve) => server.server.once('listening', resolve));
const base = `http://127.0.0.1:${server.server.address().port}`;

async function waitForDatabase() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (mongoose.connection.readyState === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('MongoDB no alcanzó el estado connected.');
}

async function request(pathname, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

let passed = 0;

function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ` — ${detail}` : ''}`);
  passed += 1;
  console.log(`  OK ${name}`);
}

try {
  await waitForDatabase();

  await User.create({
    name: 'Admin Prueba',
    email: 'admin@test.local',
    password: 'Admin12345',
    role: 'ADMIN'
  });

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@test.local', password: 'Admin12345' }
  });
  check('login devuelve JWT', login.status === 200 && Boolean(login.body.data.token), JSON.stringify(login.body.errors));
  const token = login.body.data.token;

  const product = await request('/api/products', {
    method: 'POST',
    token,
    body: {
      sku: 'INT-000001',
      name: 'Producto integración',
      priceUSD: 10,
      costUSD: 6,
      stock: 10,
      minimumStock: 3,
      batches: [{ lot: 'LOT-1', quantity: 10, expirationDate: '2028-01-01' }]
    }
  });
  check('crear producto', product.status === 201, JSON.stringify(product.body.errors));
  const productId = product.body.data.id;
  check('precio VES derivado de BCV', product.body.data.pricing.price.VES.amount === 360);

  const saleBody = {
    currency: 'USD',
    items: [{ productId, quantity: 2 }],
    payment: { method: 'CASH_USD', amount: 23.2 }
  };
  const idempotencyKey = '11111111-1111-4111-8111-111111111111';
  const sale = await request('/api/sales', {
    method: 'POST',
    token,
    body: saleBody,
    headers: { 'X-Idempotency-Key': idempotencyKey }
  });
  check('registrar venta', sale.status === 201, JSON.stringify(sale.body.errors));
  check('IVA calculado por línea', sale.body.data.totals.iva.amount === 3.2, JSON.stringify(sale.body.data.totals));
  check('total correcto', sale.body.data.totals.total.amount === 23.2);
  check('stock descontado', sale.body.data.items[0].stockAfter === 8);

  const retry = await request('/api/sales', {
    method: 'POST',
    token,
    body: saleBody,
    headers: { 'X-Idempotency-Key': idempotencyKey }
  });
  check('reintento idempotente', retry.status === 200 && retry.body.data.id === sale.body.data.id);

  const persisted = await Product.findById(productId).lean();
  check('reintento no desconta dos veces', persisted.stock.available === 8, `stock=${persisted.stock.available}`);

  const lowStock = await request('/api/products/low-stock', { token });
  check('producto no aparece en stock bajo', lowStock.status === 200 && lowStock.body.data.length === 0);

  const saleId = sale.body.data.id;
  const voided = await request(`/api/sales/${saleId}/void`, {
    method: 'POST',
    token,
    body: { reason: 'Prueba de anulación' }
  });
  check('anular venta', voided.status === 200, JSON.stringify(voided.body.errors));

  const restored = await Product.findById(productId).lean();
  check('anulación restaura stock', restored.stock.available === 10, `stock=${restored.stock.available}`);

  const report = await request('/api/reports/sales', { token });
  check('reporte de ventas responde', report.status === 200 && report.body.data.reportKey === 'sales');

  const customers = await request('/api/customers', { token });
  check('listado de clientes responde', customers.status === 200);

  console.log(`\nINTEGRATION OK (${passed} verificaciones)`);
  process.exitCode = 0;
} catch (error) {
  console.error('\nINTEGRATION FAIL:', error.message);
  process.exitCode = 1;
} finally {
  await server.close();
  await mongoose.disconnect();
  await replSet.stop();
}
