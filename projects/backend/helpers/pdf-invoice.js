import { round2 } from './money.js';
import { createSimplePdf } from './pdf.js';

/**
 * Helper canónico del comprobante digital de una venta.
 * Devuelve un Buffer reutilizable tanto para descarga como para adjunto de correo.
 */

export function invoiceFileName(sale) {
  const number = String(sale?.invoice?.number || sale?.number || 'FAC-000000');
  return `${number.replace(/^VTA/, 'FAC')}.pdf`;
}

function invoiceNumber(sale) {
  return String(sale?.invoice?.number || sale?.number || 'FAC-000000').replace(/^VTA/, 'FAC');
}

function taxLabel(rate) {
  return `${Number((Number(rate || 0) * 100).toFixed(2))}%`;
}

function amount(value) {
  return round2(Number(value) || 0);
}

/** Construye las líneas del comprobante. Exportado para pruebas y auditoría. */
export function buildInvoiceLines(sale) {
  const customer = sale?.customerSnapshot || {};
  const totals = sale?.totals || {};
  const exchange = sale?.exchangeSnapshot || {};
  const items = Array.isArray(sale?.items) ? sale.items : [];

  const lines = [
    `Factura: ${invoiceNumber(sale)}`,
    `Control: ${sale?.invoice?.controlNumber || 'N/A'}`,
    `Estado: ${sale?.status || 'COMPLETED'}`,
    `Fecha: ${sale?.audit?.createdAt || sale?.createdAt || ''}`,
    `Cliente: ${customer.name || 'Consumidor final'}`,
    `Documento: ${sale?.customerRUT || customer.documentNumber || 'N/A'}`,
    `Correo: ${customer.email || 'N/A'}`,
    `Telefono: ${customer.phone || 'N/A'}`,
    `Pago: ${sale?.paymentMethod || sale?.payment?.label || sale?.payment?.method || 'N/A'}`,
    '',
    'Detalle:'
  ];

  items.forEach((item) => {
    lines.push(`${item.quantity} x ${item.sku || ''} ${item.name || ''}`.trim());
    lines.push(
      `  Precio USD ${amount(item.unitPrice?.amount ?? item.priceUSD)}  Descuento USD ${amount(item.discount?.amount?.amount)}`
    );
    lines.push(
      `  Base USD ${amount(item.subtotal?.amount ?? item.subtotalUSD)}  IVA ${taxLabel(item.tax?.rate)} USD ${amount(item.tax?.amount?.amount)}  Total USD ${amount(item.total?.amount)}`
    );
    if (item.lot) lines.push(`  Lote: ${item.lot}`);
  });

  lines.push('', 'Totales:');
  lines.push(`Subtotal USD: ${amount(totals.subtotal?.amount)}`);
  lines.push(`Descuento USD: ${amount(totals.discount?.amount)}`);
  lines.push(`Base imponible USD: ${amount(totals.taxableBase?.amount)}`);
  lines.push(`IVA USD: ${amount(totals.iva?.amount)}`);
  lines.push(`Total USD: ${amount(totals.total?.amount)}`);
  lines.push(`Total VES: ${amount(totals.totalInVES?.amount)}`);
  lines.push(
    `Tasa BCV: ${exchange.value ?? 'N/A'} (${exchange.date || 'N/A'}) Fuente: ${exchange.source || 'BCV'}`
  );

  if (exchange.isFallback) {
    lines.push('Tasa de respaldo - pendiente de confirmacion BCV');
  }

  return lines;
}

export function generateInvoicePdf(sale) {
  return createSimplePdf(`Factura ${invoiceNumber(sale)}`, buildInvoiceLines(sale));
}

/** Alias de compatibilidad con el helper anterior. */
export const invoicePdf = generateInvoicePdf;
