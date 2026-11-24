/** Normaliza a Latin-1 para poder escribir PDF sin dependencias externas. */
function pdfText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/([\\()])/g, '\\$1');
}

const LINES_PER_PAGE = 38;

/**
 * Genera un PDF válido con texto plano (Helvetica) y paginación automática.
 * La firma pública no cambia: el constructor decide cuántas páginas necesita.
 */
export function createSimplePdf(title, lines = []) {
  const safeTitle = pdfText(title);
  const chunks = [];
  for (let index = 0; index < lines.length; index += LINES_PER_PAGE) {
    chunks.push(lines.slice(index, index + LINES_PER_PAGE));
  }
  if (chunks.length === 0) chunks.push([]);

  const contents = chunks.map((chunk, pageIndex) => {
    let content = '';
    if (pageIndex === 0) {
      content += `BT /F1 18 Tf 50 790 Td (${safeTitle}) Tj ET\n`;
      content += 'BT /F1 9 Tf 50 770 Td (PymePlus IA - America/Caracas) Tj ET\n';
    } else {
      content += `BT /F1 14 Tf 50 790 Td (${safeTitle} - continuacion) Tj ET\n`;
      content += `BT /F1 9 Tf 50 770 Td (Pagina ${pageIndex + 1}) Tj ET\n`;
    }

    chunk.forEach((line, index) => {
      const y = 745 - index * 18;
      content += `BT /F1 11 Tf 50 ${y} Td (${pdfText(line)}) Tj ET\n`;
    });

    return content;
  });

  const pageCount = contents.length;
  const fontNumber = 3 + pageCount * 2;
  const kids = contents.map((_content, index) => `${3 + index * 2} 0 R`).join(' ');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`
  ];

  contents.forEach((content, index) => {
    const pageNumber = 3 + index * 2;
    const contentNumber = pageNumber + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>`
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
    );
  });

  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );

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
