import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInvoiceLines,
  generateInvoicePdf,
  invoiceFileName,
  invoicePdf
} from '../helpers/pdf-invoice.js';

function sale(overrides = {}) {
  return {
    number: 'VTA-2026-000123',
    invoice: { number: 'FAC-2026-000123', controlNumber: 'CTRL-2026-000123' },
    status: 'COMPLETED',
    audit: { createdAt: '2026-11-23T14:34:05-04:00' },
    customerRUT: 'J-12345678-9',
    customerSnapshot: {
      name: 'Comercial La Esquina',
      documentNumber: 'J-12345678-9',
      email: 'contacto@test.local',
      phone: '+58 412 1234567'
    },
    paymentMethod: 'Punto de Venta',
    items: [
      {
        sku: 'BOD-000123',
        name: 'Aceite vegetal 1 L',
        quantity: 2,
        unitPrice: { amount: 6.5 },
        subtotal: { amount: 11.7 },
        tax: { rate: 0.16, amount: { amount: 1.87 } },
        total: { amount: 13.57 },
        lot: 'LOT-1'
      }
    ],
    totals: {
      subtotal: { amount: 13 },
      discount: { amount: 1.3 },
      taxableBase: { amount: 11.7 },
      iva: { amount: 1.87 },
      total: { amount: 13.57 },
      totalInVES: { amount: 488.52 }
    },
    exchangeSnapshot: { value: 36, date: '2026-11-23', source: 'BCV', isFallback: true },
    ...overrides
  };
}

test('invoiceFileName deriva FAC desde el número histórico', () => {
  assert.equal(invoiceFileName(sale()), 'FAC-2026-000123.pdf');
  assert.equal(invoiceFileName({ number: 'FAC-2026-000999' }), 'FAC-2026-000999.pdf');
});

test('el comprobante usa FAC, RUT, alícuota real y leyenda de tasa de respaldo', () => {
  const lines = buildInvoiceLines(sale()).join('\n');
  assert.match(lines, /Factura: FAC-2026-000123/);
  assert.match(lines, /Documento: J-12345678-9/);
  assert.match(lines, /Pago: Punto de Venta/);
  assert.match(lines, /IVA 16% USD 1.87/);
  assert.match(lines, /Tasa BCV: 36 \(2026-11-23\) Fuente: BCV/);
  assert.match(lines, /Tasa de respaldo - pendiente de confirmacion BCV/);

  const buffer = generateInvoicePdf(sale());
  const pdf = buffer.toString('latin1');
  assert.equal(buffer.subarray(0, 8).toString(), '%PDF-1.4');
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  assert.match(pdf, /Factura FAC-2026-000123/);
});

test('una línea exenta muestra IVA 0% y no inventa impuesto', () => {
  const data = sale();
  data.items[0].tax = { rate: 0, amount: { amount: 0 } };
  data.totals.iva = { amount: 0 };
  const lines = buildInvoiceLines(data).join('\n');
  assert.match(lines, /IVA 0% USD 0/);
  assert.doesNotMatch(lines, /IVA 16%/);
});

test('ventas largas paginan sin truncar líneas', () => {
  const data = sale({
    items: Array.from({ length: 80 }, (_unused, index) => ({
      sku: `ITEM-${String(index).padStart(3, '0')}`,
      name: `Producto ${index}`,
      quantity: 1,
      unitPrice: { amount: 1 },
      subtotal: { amount: 1 },
      tax: { rate: 0.16, amount: { amount: 0.16 } },
      total: { amount: 1.16 }
    }))
  });

  const pdf = generateInvoicePdf(data).toString('latin1');
  const count = Number(pdf.match(/\/Count (\d+)/)[1]);
  assert.ok(count > 1, `se esperaban varias páginas, se generaron ${count}`);
  assert.match(pdf, /ITEM-079/);
});

test('invoicePdf conserva el alias del helper anterior', () => {
  assert.equal(invoicePdf(sale()).toString('latin1'), generateInvoicePdf(sale()).toString('latin1'));
});

test('el xref apunta a objetos reales y /Count coincide con las páginas', () => {
  const data = sale({
    items: Array.from({ length: 80 }, (_unused, index) => ({
      sku: `ITEM-${String(index).padStart(3, '0')}`,
      name: `Producto ${index}`,
      quantity: 1,
      unitPrice: { amount: 1 },
      subtotal: { amount: 1 },
      tax: { rate: 0.16, amount: { amount: 0.16 } },
      total: { amount: 1.16 }
    }))
  });

  const pdf = generateInvoicePdf(data).toString('latin1');
  const count = Number(pdf.match(/\/Count (\d+)/)[1]);
  const size = Number(pdf.match(/\/Size (\d+)/)[1]);
  const xrefOffset = Number(pdf.match(/startxref\n(\d+)/)[1]);

  assert.equal(pdf.slice(xrefOffset, xrefOffset + 4), 'xref');
  const offsets = [...pdf.slice(xrefOffset).matchAll(/^(\d{10}) 00000 n /gm)].map((match) =>
    Number(match[1])
  );
  assert.equal(offsets.length, size - 1);
  for (const offset of offsets) {
    assert.match(pdf.slice(offset, offset + 20), /^\d+ 0 obj/);
  }
  assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, count);
});
