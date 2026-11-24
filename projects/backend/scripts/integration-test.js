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
const { default: Customer } = await import('../api/customers/customer.model.js');

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
  check('login entrega refresh token', Boolean(login.body.data.refreshToken));

  const { default: RefreshToken } = await import('../api/auth/refresh-token.model.js');
  const storedRefresh = await RefreshToken.findOne({ userId: login.body.data.user.id }).lean();
  check(
    'refresh token persistido solo como hash',
    Boolean(storedRefresh) &&
      storedRefresh.tokenHash !== login.body.data.refreshToken &&
      /^[a-f0-9]{64}$/.test(storedRefresh.tokenHash)
  );

  const refreshed = await request('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken: login.body.data.refreshToken }
  });
  check(
    'renovación de sesión con rotación',
    refreshed.status === 200 && Boolean(refreshed.body.data.token) && Boolean(refreshed.body.data.refreshToken)
  );
  const reuse = await request('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken: login.body.data.refreshToken }
  });
  check('refresh token anterior queda revocado', reuse.status === 401);

  // Captura de eventos Socket.IO sin depender de un cliente externo.
  const emitted = [];
  const originalEmit = server.io.emit.bind(server.io);
  server.io.emit = (event, payload) => {
    emitted.push({ event, payload });
    return originalEmit(event, payload);
  };

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
  check(
    'campos públicos de producto',
    product.body.data.sku === 'INT-000001' &&
      product.body.data.category === 'General' &&
      product.body.data.costUSD === 6 &&
      product.body.data.priceUSD === 10 &&
      product.body.data.stockCurrent === 10 &&
      product.body.data.stockMinimum === 3 &&
      product.body.data.isActive === true,
    JSON.stringify(product.body.data)
  );

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
  check(
    'campos públicos de factura',
    sale.body.data.invoiceNumber?.startsWith('FAC') &&
      sale.body.data.totalUSD === 23.2 &&
      sale.body.data.totalVES === 835.2 &&
      sale.body.data.exchangeRate === 36 &&
      sale.body.data.paymentMethod === 'Efectivo USD' &&
      sale.body.data.items[0].priceUSD === 10 &&
      sale.body.data.items[0].subtotalUSD === 20,
    JSON.stringify(sale.body.data)
  );
  check(
    'ambos eventos de stock con el mismo payload',
    emitted.some((e) => e.event === 'stock_updated') &&
      emitted.some((e) => e.event === 'stock:updated') &&
      JSON.stringify(emitted.find((e) => e.event === 'stock_updated').payload) ===
        JSON.stringify(emitted.find((e) => e.event === 'stock:updated').payload),
    JSON.stringify(emitted.map((e) => e.event))
  );

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

  // Ventana de facturación con el contrato nuevo y reenvío de correo.
  const invoiceSale = await request('/api/sales', {
    method: 'POST',
    token,
    body: {
      currency: 'USD',
      customerRUT: 'J-12345678-9',
      customerEmail: 'factura@test.local',
      paymentMethod: 'Punto de Venta',
      items: [{ productId, quantity: 1 }]
    },
    headers: { 'X-Idempotency-Key': '22222222-2222-4222-8222-222222222222' }
  });
  check(
    'venta con paymentMethod y customerRUT',
    invoiceSale.status === 201 &&
      invoiceSale.body.data.paymentMethod === 'Punto de Venta' &&
      invoiceSale.body.data.customerRUT === 'J-12345678-9',
    JSON.stringify(invoiceSale.body)
  );

  const resend = await request(`/api/sales/${invoiceSale.body.data.id}/resend-invoice`, {
    method: 'POST',
    token,
    body: {}
  });
  check(
    'reenvío de factura encola sin webhook',
    resend.status === 202 && resend.body.data.queued === true && resend.body.data.sent === false,
    JSON.stringify(resend.body)
  );

  // Tasa BCV: carga manual, historial y vigencia.
  const rateDate = new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
  const ratePost = await request('/api/exchange-rates', {
    method: 'POST',
    token,
    body: { date: rateDate, value: 40, source: 'BCV', reason: 'Prueba de integración' }
  });
  check('cargar tasa BCV', ratePost.status === 201, JSON.stringify(ratePost.body));

  const currentRate = await request('/api/exchange-rates/current', { token });
  check(
    'tasa vigente refleja la carga manual',
    currentRate.status === 200 && currentRate.body.data.value === 40 && currentRate.body.data.isFallback === false,
    JSON.stringify(currentRate.body)
  );

  const history = await request('/api/exchange-rates/history', { token });
  check('historial de tasas', history.status === 200 && history.body.data.length >= 1);

  // Saldo de crédito real en anulación.
  const creditCustomer = await Customer.create({
    name: 'Cliente Crédito',
    documentType: 'RIF',
    documentNumber: 'J-87654321-0',
    email: 'credito@test.local',
    credit: { enabled: true, limitUSD: 100, balanceUSD: 0 }
  });
  const creditSale = await request('/api/sales', {
    method: 'POST',
    token,
    body: {
      currency: 'USD',
      customerId: String(creditCustomer._id),
      payment: { method: 'CREDIT' },
      items: [{ productId, quantity: 1 }]
    },
    headers: { 'X-Idempotency-Key': '33333333-3333-4333-8333-333333333333' }
  });
  check('venta a crédito', creditSale.status === 201, JSON.stringify(creditSale.body));
  check(
    'saldo de crédito aumenta',
    (await Customer.findById(creditCustomer._id)).credit.balanceUSD === 11.6
  );

  const creditVoid = await request(`/api/sales/${creditSale.body.data.id}/void`, {
    method: 'POST',
    token,
    body: { reason: 'Anulación de prueba de crédito' }
  });
  check('anular venta a crédito', creditVoid.status === 200, JSON.stringify(creditVoid.body));
  check(
    'anulación descuenta el saldo real de crédito',
    (await Customer.findById(creditCustomer._id)).credit.balanceUSD === 0,
    `saldo=${(await Customer.findById(creditCustomer._id)).credit.balanceUSD}`
  );

  // CRUD completo de inventario con un producto aislado del flujo de facturación.
  const catalog = await request('/api/products', {
    method: 'POST',
    token,
    body: {
      sku: 'INT-000002',
      name: 'Producto de catálogo',
      category: 'Abarrotes',
      imageUrl: '/uploads/images/catalogo.png',
      priceUSD: 5,
      stockCurrent: 2,
      stockMinimum: 1
    }
  });
  check(
    'crear producto con categoría e imagen',
    catalog.status === 201 &&
      catalog.body.data.category === 'Abarrotes' &&
      catalog.body.data.imageUrl === '/uploads/images/catalogo.png' &&
      catalog.body.data.isActive === true,
    JSON.stringify(catalog.body)
  );
  const catalogId = catalog.body.data.id;

  const search = await request('/api/products?q=000002', { token });
  check(
    'búsqueda por texto',
    search.status === 200 && search.body.data.some((item) => item.id === catalogId)
  );

  const bySku = await request('/api/products/sku/INT-000002', { token });
  check('búsqueda por SKU', bySku.status === 200 && bySku.body.data.id === catalogId);

  const updated = await request(`/api/products/${catalogId}`, {
    method: 'PATCH',
    token,
    body: { name: 'Producto actualizado', priceUSD: 6, category: 'Bebidas' }
  });
  check(
    'actualizar producto',
    updated.status === 200 &&
      updated.body.data.name === 'Producto actualizado' &&
      updated.body.data.priceUSD === 6 &&
      updated.body.data.category === 'Bebidas',
    JSON.stringify(updated.body)
  );

  const adjusted = await request(`/api/products/${catalogId}/stock-adjustments`, {
    method: 'POST',
    token,
    body: { reason: 'RECEIPT', quantity: 5 }
  });
  check(
    'ajuste de stock atómico',
    adjusted.status === 201 && adjusted.body.data.stockCurrent === 7,
    JSON.stringify(adjusted.body)
  );

  const removed = await request(`/api/products/${catalogId}`, { method: 'DELETE', token });
  check(
    'baja lógica del producto',
    removed.status === 200 && removed.body.data.isActive === false
  );

  const inactive = await request('/api/products?active=false', { token });
  check(
    'filtro por producto inactivo',
    inactive.status === 200 && inactive.body.data.some((item) => item.id === catalogId)
  );

  // Comprobante PDF: misma fuente para descarga y correo.
  const pdfResponse = await fetch(`${base}/api/sales/${invoiceSale.body.data.id}/invoice.pdf`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
  const expectedPdfName = `FAC-${String(invoiceSale.body.data.number).replace(/^VTA-/, '')}.pdf`;
  check(
    'descarga del comprobante PDF',
    pdfResponse.status === 200 &&
      pdfResponse.headers.get('content-type')?.includes('application/pdf') &&
      pdfResponse.headers.get('content-disposition')?.includes(expectedPdfName) &&
      pdfBuffer.subarray(0, 8).toString() === '%PDF-1.4' &&
      pdfBuffer.toString('latin1').includes('Factura FAC-'),
    `status=${pdfResponse.status} contenido=${pdfResponse.headers.get('content-type')}`
  );
  check(
    'evento invoice:ready emitido',
    emitted.some((event) => event.event === 'invoice:ready'),
    JSON.stringify([...new Set(emitted.map((event) => event.event))])
  );

  // Autorización de precios por rol.
  await User.create({
    name: 'Almacén Prueba',
    email: 'warehouse@test.local',
    password: 'Admin12345',
    role: 'WAREHOUSE'
  });
  const warehouseLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'warehouse@test.local', password: 'Admin12345' }
  });
  const warehouseToken = warehouseLogin.body.data.token;
  check('login de almacén', warehouseLogin.status === 200 && Boolean(warehouseToken));

  const warehouseRename = await request(`/api/products/${productId}`, {
    method: 'PATCH',
    token: warehouseToken,
    body: { name: 'Nombre editado por almacén' }
  });
  check(
    'almacén edita datos no monetarios',
    warehouseRename.status === 200,
    JSON.stringify(warehouseRename.body)
  );

  const warehousePrice = await request(`/api/products/${productId}`, {
    method: 'PATCH',
    token: warehouseToken,
    body: { priceUSD: 99 }
  });
  check(
    'almacén no puede modificar precios',
    warehousePrice.status === 403 && warehousePrice.body.errors[0].code === 'FORBIDDEN',
    JSON.stringify(warehousePrice.body)
  );

  const warehouseCreate = await request('/api/products', {
    method: 'POST',
    token: warehouseToken,
    body: { sku: 'INT-000003', name: 'Producto de almacén', priceUSD: 5 }
  });
  check(
    'almacén no puede crear productos con precio',
    warehouseCreate.status === 403,
    JSON.stringify(warehouseCreate.body)
  );

  const adminPrice = await request(`/api/products/${productId}`, {
    method: 'PATCH',
    token,
    body: { priceUSD: 10 }
  });
  check(
    'administrador sí puede modificar precios',
    adminPrice.status === 200 && adminPrice.body.data.priceUSD === 10,
    JSON.stringify(adminPrice.body)
  );

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
