import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, badRequest, normalizeError } from '../helpers/errors.js';
import {
  dateParam,
  parseCustomerRUT,
  positiveInt,
  requireNumber
} from '../helpers/validators.js';
import { invoiceFileName } from '../helpers/pdf-invoice.js';

test('normalizeError traduce CastError a 400 con campo', () => {
  const error = new Error('Cast to ObjectId failed');
  error.name = 'CastError';
  error.path = 'customerId';
  const normalized = normalizeError(error);
  assert.ok(normalized instanceof ApiError);
  assert.equal(normalized.status, 400);
  assert.equal(normalized.field, 'customerId');
});

test('normalizeError traduce ValidationError y JSON inválido', () => {
  const validation = new Error('Validation failed');
  validation.name = 'ValidationError';
  validation.errors = { sku: { message: 'sku es obligatorio' } };
  assert.equal(normalizeError(validation).status, 400);
  assert.equal(normalizeError(validation).field, 'sku');

  const syntax = new SyntaxError('Unexpected token');
  syntax.body = '{';
  assert.equal(normalizeError(syntax).status, 400);
  assert.equal(normalizeError(syntax).field, 'body');

  const tooLarge = Object.assign(new Error('too large'), { type: 'entity.too.large' });
  assert.equal(normalizeError(tooLarge).status, 413);
});

test('normalizeError conserva errores de dominio', () => {
  const original = badRequest('Dato inválido.', { field: 'items' });
  assert.equal(normalizeError(original), original);
});

test('un pasaporte sin caracteres alfanuméricos se rechaza', () => {
  assert.throws(() => parseCustomerRUT('----------'), (error) => error.status === 400);
  assert.equal(parseCustomerRUT('AB123456'), 'AB123456');
});

test('requireNumber rechaza NaN, Infinity y vacío', () => {
  for (const value of [NaN, Infinity, '', null, undefined]) {
    assert.throws(() => requireNumber(value, 'total'), (error) => error.status === 400);
  }
  assert.equal(requireNumber('12.5', 'total'), 12.5);
});

test('positiveInt acota paginación', () => {
  assert.equal(positiveInt(undefined, 'page', 1), 1);
  for (const value of ['0', -1, 1.5, 101, 'basura']) {
    assert.throws(() => positiveInt(value, 'limit', 20), (error) => error.status === 400);
  }
  assert.equal(positiveInt('20', 'limit', 20), 20);
});

test('dateParam rechaza fechas imposibles antes de Mongoose', () => {
  for (const value of ['basura', '2026-13-45', '2026-02-30']) {
    assert.throws(() => dateParam(value, 'from'), (error) => error.status === 400);
  }
  assert.equal(dateParam(undefined, 'from'), undefined);
  assert.equal(dateParam('2026-11-23', 'from').toISOString().slice(0, 10), '2026-11-23');
});

test('invoiceFileName elimina caracteres de trayectoria', () => {
  const hostile = invoiceFileName({ number: '../../etc/passwd' });
  assert.ok(!hostile.includes('/') && !hostile.includes('\\'));
  assert.ok(!hostile.startsWith('.'));
  assert.ok(hostile.endsWith('.pdf'));
  assert.equal(invoiceFileName({ invoice: { number: 'FAC-2026-000123' } }), 'FAC-2026-000123.pdf');
  assert.equal(invoiceFileName({ number: 'VTA-2026-000123' }), 'FAC-2026-000123.pdf');
});
