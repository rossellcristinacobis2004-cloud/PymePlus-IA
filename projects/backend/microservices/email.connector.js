import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/**
 * Conector de correo con dos modos:
 *  - MAIL_WEBHOOK_URL definida: envía la factura a un proveedor HTTP.
 *  - Sin proveedor: la escribe en microservices/outbox/ para envío posterior.
 * Nunca afirma que un correo fue enviado si solo quedó encolado.
 */
const OUTBOX_DIR = path.resolve(process.cwd(), 'microservices/outbox');

function safeName(value) {
  return String(value || 'destino')
    .replace(/[^a-zA-Z0-9@._-]/g, '_')
    .slice(0, 80);
}

export async function sendInvoice({ to, subject, fileName, pdfBuffer }) {
  const attachmentBase64 = Buffer.from(pdfBuffer || Buffer.alloc(0)).toString('base64');
  const payload = { to, subject, fileName, attachmentBase64 };

  if (process.env.MAIL_WEBHOOK_URL) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (process.env.MAIL_WEBHOOK_TOKEN) {
        headers.Authorization = `Bearer ${process.env.MAIL_WEBHOOK_TOKEN}`;
      }
      const response = await fetch(process.env.MAIL_WEBHOOK_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        return { queued: false, sent: true, channel: 'webhook' };
      }
      console.error(`[MAIL] Webhook respondió estado ${response.status}; se encola localmente.`);
    } catch (error) {
      console.error(`[MAIL] Webhook no disponible (${error.message}); se encola localmente.`);
    }
  }

  await fs.mkdir(OUTBOX_DIR, { recursive: true });
  const queueId = crypto.randomUUID();
  const queueFile = `${Date.now()}-${safeName(to)}-${queueId}.json`;
  await fs.writeFile(
    path.join(OUTBOX_DIR, queueFile),
    JSON.stringify({ id: queueId, queuedAt: new Date().toISOString(), ...payload }, null, 2),
    { encoding: 'utf8', mode: 0o600 }
  );

  return { queued: true, sent: false, channel: 'outbox', queueFile };
}
