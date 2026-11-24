import test from 'node:test';
import assert from 'node:assert/strict';

import Product, { PRODUCT_CATEGORIES } from '../api/products/product.model.js';
import { serializeProduct } from '../helpers/serializers.js';
import { resolvePayment, toDisplayPaymentMethod } from '../helpers/payment.js';
import { parseCustomerRUT } from '../helpers/validators.js';

const rate = { value: 36, source: 'BCV', date: '2026-11-23', capturedAt: new Date('2026-11-23T12:00:00Z') };

function product(overrides = {}) {
  return new Product({
    sku: 'TEST-1',
    name: 'Producto',
    category: 'General',
    pricing: { costUSD: 6, priceUSD: 10, ...overrides.pricing },
    stock: { available: 10, minimum: 3, ...overrides.stock },
    ...overrides.rest
  });
}

test('categoría admitidas por el contrato de inventario', async () => {
  assert.deepEqual([...PRODUCT_CATEGORIES], ['Abarrotes', 'Bebidas', 'Ferretería', 'Farmacia', 'General']);
  assert.equal(await product({ rest: { category: 'Abarrotes' } }).validate(), undefined);
  await assert.rejects(() => product({ rest: { category: 'Inexistente' } }).validate());
});

test('virtuales de producto delegan en el storage histórico', () => {
  const doc = product();
  assert.equal(doc.costUSD, 6);
  assert.equal(doc.priceUSD, 10);
  assert.equal(doc.stockCurrent, 10);
  assert.equal(doc.stockMinimum, 3);
  assert.equal(doc.isActive, true);

  doc.costUSD = 7;
  doc.priceUSD = 12;
  doc.stockCurrent = 4;
  doc.stockMinimum = 2;
  doc.isActive = false;

  assert.equal(doc.pricing.costUSD, 7);
  assert.equal(doc.pricing.priceUSD, 12);
  assert.equal(doc.stock.available, 4);
  assert.equal(doc.stock.minimum, 2);
  assert.equal(doc.flags.active, false);
  assert.equal(doc.isActive, false);
});

test('serializador AUTO_BCV convierte con la tasa vigente', () => {
  const result = serializeProduct(product(), rate);
  assert.equal(result.pricing.price.USD.amount, 10);
  assert.equal(result.pricing.price.VES.amount, 360);
  assert.equal(result.pricing.price.VES.rateUsed.value, 36);
});

test('serializador MANUAL_VES usa el precio manual sin snapshot de BCV', () => {
  const result = serializeProduct(
    product({ pricing: { mode: 'MANUAL_VES', manualPriceVES: 250 } }),
    rate
  );
  assert.equal(result.pricing.price.VES.amount, 250);
  assert.equal(result.pricing.price.VES.source, 'MANUAL');
  assert.equal(result.pricing.price.VES.rateUsed, null);
});

test('serializador PROMOTION usa el precio promocional y lo marca', () => {
  const result = serializeProduct(
    product({ pricing: { mode: 'PROMOTION', promotionPriceUSD: 5 } }),
    rate
  );
  assert.equal(result.pricing.price.VES.amount, 180);
  assert.equal(result.pricing.price.VES.isPromotion, true);
});

test('serializador muestra tasa 0 para IVA exento', () => {
  const result = serializeProduct(product({ pricing: { tax: 'IVA_EXENTO' } }), rate);
  assert.equal(result.pricing.tax.type, 'IVA_EXENTO');
  assert.equal(result.pricing.tax.rate, 0);
});

test('mapeo de métodos de pago nuevos e históricos', () => {
  assert.deepEqual(resolvePayment({ paymentMethod: 'Punto de Venta' }), {
    display: 'Punto de Venta',
    internal: 'CARD'
  });
  assert.deepEqual(resolvePayment({ payment: { method: 'CASH_USD' } }), {
    display: 'Efectivo USD',
    internal: 'CASH_USD'
  });
  assert.equal(toDisplayPaymentMethod('TRANSFER'), 'Pago Móvil');
  assert.throws(() => resolvePayment({ paymentMethod: 'Bitcoin' }));
});

test('customerRUT acepta RIF, cédula y pasaporte', () => {
  assert.equal(parseCustomerRUT('J-12345678-9'), 'J-12345678-9');
  assert.equal(parseCustomerRUT('v-12345678'), 'V-12345678');
  assert.equal(parseCustomerRUT('AB123456'), 'AB123456');
  assert.equal(parseCustomerRUT(null), null);
  assert.throws(() => parseCustomerRUT('!!!'));
});
