import { round2 } from './money.js';

/** Normaliza a Latin-1 para poder escribir PDF sin dependencias externas. */
function pdfText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/([\\()])/g, '\\$1');
}

/** Genera un PDF válido de una página con texto plano (Helvetica). */
export function createSimplePdf(title, lines = []) {
  const safeTitle = pdfText(title);
  let content = `BT /F1 18 Tf 50 790 Td (${safeTitle}) Tj ET\n`;
  content += 'BT /F1 9 Tf 50 770 Td (PymePlus IA - America/Caracas) Tj ET\n';

  lines.slice(0, 55).forEach((line, index) => {
    const y = 745 - index * 18;
    content += `BT /F1 11 Tf 50 ${y} Td (${pdfText(line)}) Tj ET\n`;
  });

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

export function invoicePdf(sale) {
  const lines = [
    `Factura: ${sale.number}`,
    `Fecha: ${sale.audit?.createdAt || ''}`,
    `Cliente: ${sale.customerSnapshot?.name || 'Consumidor final'}`,
    `Documento: ${sale.customerSnapshot?.documentNumber || 'N/A'}`,
    '',
    'Detalle:',
    ...sale.items.map(
      (item) =>
        `${item.quantity} x ${item.name}  USD ${round2(item.unitPrice.amount)}  Total USD ${round2(item.total.amount)}`
    ),
    '',
    `Subtotal USD: ${round2(sale.totals.subtotal.amount)}`,
    `Descuento USD: ${round2(sale.totals.discount.amount)}`,
    `Base imponible USD: ${round2(sale.totals.taxableBase.amount)}`,
    `IVA (16%) USD: ${round2(sale.totals.iva.amount)}`,
    `Total USD: ${round2(sale.totals.total.amount)}`,
    `Total VES: ${round2(sale.totals.totalInVES.amount)}`,
    `Tasa BCV: ${sale.exchangeSnapshot.value} (${sale.exchangeSnapshot.date})`,
    sale.exchangeSnapshot.isFallback ? 'Tasa de respaldo - pendiente de confirmacion BCV' : ''
  ];

  return createSimplePdf(`Factura ${sale.number}`, lines);
}
