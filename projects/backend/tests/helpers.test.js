import test from 'node:test';
import assert from 'node:assert/strict';

import { round2, round4, toVes, money } from '../helpers/money.js';
import { calculateLine } from '../helpers/tax.js';
import { validateBarcode, validateDocument, validateEmail } from '../helpers/validators.js';
import { createSimplePdf } from '../helpers/pdf.js';
import { nowIso } from '../helpers/response.js';

test('round2 aplica HALF_UP también a negativos', () => {
  assert.equal(round2(11.872), 11.87);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(-1.872), -1.87);
});

test('round4 limita la tasa a 4 decimales', () => {
  assert.equal(round4(36.12345), 36.1235);
});

test('IVA general: 6,50 x 2 con 10% de descuento', () => {
  const line = calculateLine({
    unitPriceUSD: 6.5,
    quantity: 2,
    discountPercent: 10,
    taxType: 'IVA_GENERAL'
  });
  assert.equal(line.gross, 13);
  assert.equal(line.discount, 1.3);
  assert.equal(line.taxableBase, 11.7);
  assert.equal(line.iva, 1.87);
  assert.equal(line.total, 13.57);
});

test('IVA incluido: el impuesto se obtiene por diferencia', () => {
  const line = calculateLine({
    unitPriceUSD: 13.57,
    quantity: 1,
    taxType: 'IVA_GENERAL',
    priceIncludesTax: true
  });
  assert.equal(line.taxableBase, 11.7);
  assert.equal(line.iva, 1.87);
  assert.equal(line.total, 13.57);
});

test('IVA exento no genera impuesto', () => {
  const line = calculateLine({ unitPriceUSD: 10, quantity: 3, taxType: 'IVA_EXENTO' });
  assert.equal(line.iva, 0);
  assert.equal(line.total, 30);
});

test('conversión USD a VES con tasa BCV', () => {
  assert.equal(toVes(13.57, 36), 488.52);
  assert.equal(toVes(6.5, 36), 234);
});

test('Money adjunta rateUsed solo para VES', () => {
  assert.equal(money(10, 'USD').rateUsed, null);
  assert.deepEqual(money(10, 'VES', { value: 36 }).rateUsed, { value: 36 });
});

test('validadores de documento venezolano', () => {
  assert.deepEqual(validateDocument('rif', 'j-12345678-9'), {
    documentType: 'RIF',
    documentNumber: 'J-12345678-9'
  });
  assert.throws(() => validateDocument('RIF', '12345678'));
  assert.throws(() => validateEmail('correo-invalido'));
});

test('validador de código de barras', () => {
  assert.equal(validateBarcode('7701234567890'), '7701234567890');
  assert.throws(() => validateBarcode('ABC-123'));
});

test('generador de PDF produce un documento válido', () => {
  const buffer = createSimplePdf('Factura FAC-1', ['Total USD 13,57']);
  assert.equal(buffer.subarray(0, 8).toString(), '%PDF-1.4');
  assert.match(buffer.toString('latin1'), /startxref/);
  assert.ok(buffer.toString('latin1').trimEnd().endsWith('%%EOF'));
});

test('timestamp usa.offset -04:00', () => {
  assert.match(nowIso(), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}-04:00$/);
});
