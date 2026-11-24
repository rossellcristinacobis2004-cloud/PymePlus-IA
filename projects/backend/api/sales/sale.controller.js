import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';

import Sale from './sale.model.js';
import IdempotencyRecord from './idempotency-record.model.js';
import Product from '../products/product.model.js';
import Customer from '../customers/customer.model.js';

import { ok, created, paginate, nowIso } from '../../helpers/response.js';
import { badRequest, conflict, notFound } from '../../helpers/errors.js';
import { money, round2, toVes } from '../../helpers/money.js';
import { calculateLine, resolveTaxType } from '../../helpers/tax.js';
import { resolvePayment } from '../../helpers/payment.js';
import { parseCustomerRUT } from '../../helpers/validators.js';
import { getActiveRate, assertCurrencyAllowed, snapshot } from '../../services/exchange-rate.service.js';
import { decrementStock, increaseStock, nextSequence } from '../../services/inventory.service.js';
import { serializeSale } from '../../helpers/serializers.js';
import { generateInvoicePdf, invoiceFileName } from '../../helpers/pdf-invoice.js';
import { sendInvoice } from '../../microservices/email.connector.js';

const INVOICE_DIR = path.resolve(process.cwd(), 'uploads/documents/invoices');
const VOID_WINDOW_HOURS = Number(process.env.VOID_WINDOW_HOURS || 24);

async function ensureInvoiceFile(sale) {
  await fs.mkdir(INVOICE_DIR, { recursive: true });
  const fileName = invoiceFileName(sale);
  const filePath = path.join(INVOICE_DIR, fileName);
  const buffer = generateInvoicePdf(sale);

  // Escritura atómica: nunca se sirve ni se adjunta un PDF a medio escribir.
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tempPath, buffer);
  await fs.rename(tempPath, filePath);

  const saleId = String(sale._id || sale.id || '');
  return {
    fileName,
    filePath,
    buffer,
    // La descarga pública de facturas no existe: siempre pasa por JWT.
    relativeUrl: `/api/sales/${saleId}/invoice.pdf`
  };
}

/** Persiste el comprobante y avisa solo a la sala del vendedor autorizado. */
async function finalizeInvoice(req, sale, eventName = 'invoice:ready') {
  const invoiceFile = await ensureInvoiceFile(sale);
  const invoice = {
    number: invoiceFile.fileName.replace(/\.pdf$/, ''),
    controlNumber: String(sale.number).replace(/^VTA/, 'CTRL'),
    pdfUrl: invoiceFile.relativeUrl,
    issuedAt: nowIso()
  };

  await Sale.updateOne({ _id: sale._id }, { $set: { invoice } });
  sale.invoice = invoice;

  const sellerId = sale.audit?.sellerId;
  const io = req?.app?.get('io');
  if (io && sellerId) {
    io.to(`user:${String(sellerId)}`).emit(eventName, {
      saleId: String(sale._id),
      invoiceNumber: invoice.number
    });
  }

  return invoiceFile;
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('La venta debe incluir al menos un producto.', {
      field: 'items',
      userMessage: 'Agrega productos antes de cobrar.',
      suggestion: 'Escanea un código de barras o busca un producto.'
    });
  }

  return items.map((item, index) => {
    if (!mongoose.isValidObjectId(item.productId)) {
      throw badRequest('Identificador de producto inválido.', { field: `items[${index}].productId` });
    }
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw badRequest('La cantidad debe ser mayor que cero.', { field: `items[${index}].quantity` });
    }
    const discountPercent = Number(item.discountPercent ?? item.discount?.value ?? 0);
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      throw badRequest('El descuento debe estar entre 0 y 100.', { field: `items[${index}].discount` });
    }
    return { productId: item.productId, quantity, discountPercent, lot: item.lot || null };
  });
}

function emitStockEvents(io, item) {
  if (!io) return;

  // Contrato nuevo y contrato histórico: mismo dato, dos nombres de evento.
  const productData = {
    id: String(item.productId),
    productId: String(item.productId),
    sku: item.sku,
    name: item.name,
    stockCurrent: item.stockAfter,
    available: item.stockAfter,
    delta: -item.quantity,
    reason: 'SALE_OUT'
  };

  io.emit('stock_updated', productData);
  io.emit('stock:updated', productData);
}

export async function createSale(req, res, next) {
  const key = String(req.headers['x-idempotency-key'] || '').trim();
  let recordCreated = false;

  try {
    if (!key || key.length > 100) {
      throw badRequest('Se requiere X-Idempotency-Key.', {
        field: 'X-Idempotency-Key',
        userMessage: 'No se pudo iniciar la venta de forma segura.',
        suggestion: 'Reintenta la operación desde la aplicación.'
      });
    }

    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
    const existing = await IdempotencyRecord.findOne({ key }).lean();

    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw conflict('IDEMPOTENCY_CONFLICT', 'La clave de idempotencia ya existe con otro payload.', {
          userMessage: 'La operación ya existe con otros datos. Genera una nueva venta.',
          suggestion: 'Cierra la venta y vuelve a intentarlo.'
        });
      }
      if (existing.status === 'COMPLETED') {
        let previous = await Sale.findById(existing.saleId).lean();
        // Si el proceso murió tras el commit, el reintento repara el comprobante.
        if (previous && !previous.invoice) {
          try {
            await finalizeInvoice(req, previous);
            previous = await Sale.findById(existing.saleId).lean();
          } catch (error) {
            console.error('[INVOICE] No se pudo reparar el comprobante en el reintento:', error.message);
          }
        }
        return ok(res, {
          data: previous ? serializeSale(previous) : null,
          message: 'Venta ya registrada (reintento idempotente).'
        });
      }
      throw conflict('TRANSACTION_CONFLICT', 'La operación aún está en proceso.', {
        userMessage: 'Otra operación está en curso. Espera un momento e inténtalo de nuevo.',
        suggestion: 'Reintenta en unos segundos.',
        retryable: true
      });
    }

    const body = req.body || {};
    const items = validateItems(body.items);
    const currency = String(body.currency || 'USD').toUpperCase();
    if (!['USD', 'VES'].includes(currency)) {
      throw badRequest('Moneda no soportada.', {
        field: 'currency',
        userMessage: 'Selecciona USD o VES.',
        suggestion: 'Usa USD o VES.'
      });
    }

    const paymentInput = body.payment || {};
    const payment = resolvePayment(body);
    const paymentMethod = payment.display;

    const rate = await getActiveRate();
    assertCurrencyAllowed(rate, currency);
    const rateSnap = snapshot(rate);

    let customer = null;
    if (body.customerId) {
      if (!mongoose.isValidObjectId(body.customerId)) throw badRequest('Cliente inválido.', { field: 'customerId' });
      customer = await Customer.findOne({ _id: body.customerId, active: true }).lean();
      if (!customer) throw notFound('Cliente');
      if (payment.internal === 'CREDIT' && !customer.credit.enabled) {
        throw conflict('CREDIT_LIMIT_EXCEEDED', 'El cliente no tiene crédito habilitado.', {
          userMessage: 'El cliente no tiene crédito habilitado.',
          suggestion: 'Selecciona otro método de pago.'
        });
      }
    } else if (payment.internal === 'CREDIT') {
      throw badRequest('El pago a crédito requiere un cliente.', { field: 'customerId' });
    }

    const customerRUT = parseCustomerRUT(body.customerRUT || customer?.documentNumber);
    const session = await mongoose.startSession();
    let saleDoc;

    try {
      await session.withTransaction(async () => {
        await IdempotencyRecord.create([{ key, payloadHash, status: 'PENDING' }], { session });
        recordCreated = true;

        const builtItems = [];

        for (const item of items) {
          const product = await Product.findOne({ _id: item.productId, 'flags.active': true })
            .session(session)
            .lean();

          if (!product) throw notFound('Producto');

          // Verificación explícita dentro de la transacción; el $inc condicional
          // de decrementStock es la garantía final contra carreras.
          if (Number(product.stock?.available || 0) < item.quantity) {
            throw conflict('INSUFFICIENT_STOCK', 'Stock insuficiente para la operación.', {
              userMessage: 'No hay suficiente stock disponible para completar la venta.',
              suggestion: 'Ajusta la cantidad o revisa el inventario disponible.'
            });
          }

          const now = new Date();
          const batches = product.batches || [];
          const hasExpired = batches.some(
            (batch) => batch.quantity > 0 && batch.expirationDate && new Date(batch.expirationDate) < now
          );
          const hasValidBatch = batches.some(
            (batch) =>
              batch.quantity >= item.quantity &&
              (!batch.expirationDate || new Date(batch.expirationDate) >= now)
          );

          if (product.flags.blockExpiredSale && hasExpired && !hasValidBatch) {
            throw conflict('EXPIRED_BATCH', 'El lote seleccionado está vencido.', {
              userMessage: 'El lote está vencido. Usa otro lote.',
              suggestion: 'Revisa la fecha de vencimiento del producto.'
            });
          }

          const taxType = resolveTaxType(product.pricing.tax);
          const line = calculateLine({
            unitPriceUSD: product.pricing.priceUSD,
            quantity: item.quantity,
            discountPercent: item.discountPercent,
            taxType,
            priceIncludesTax: product.pricing.priceIncludesTax
          });

          const { product: updatedProduct, lot } = await decrementStock({
            productId: item.productId,
            quantity: item.quantity,
            lot: item.lot,
            session,
            userId: req.user.id,
            saleId: null
          });

          builtItems.push({
            productId: product._id,
            sku: product.sku,
            name: product.name,
            barcode: product.barcode,
            lot,
            quantity: item.quantity,
            unit: product.stock.unit,
            unitPrice: money(product.pricing.priceUSD, 'USD'),
            discount: {
              type: 'PERCENT',
              value: item.discountPercent,
              amount: money(line.discount, 'USD')
            },
            tax: { type: taxType, rate: line.tax.rate, amount: money(line.iva, 'USD') },
            subtotal: money(line.taxableBase, 'USD'),
            total: money(line.total, 'USD'),
            stockAfter: updatedProduct.stock.available
          });
        }

        const sum = (field) => round2(builtItems.reduce((acc, item) => acc + item[field].amount, 0));
        const subtotalUSD = round2(
          builtItems.reduce((acc, item) => acc + item.unitPrice.amount * item.quantity, 0)
        );
        const discountUSD = round2(builtItems.reduce((acc, item) => acc + item.discount.amount.amount, 0));
        const baseUSD = sum('subtotal');
        const ivaUSD = round2(builtItems.reduce((acc, item) => acc + item.tax.amount.amount, 0));
        const totalUSD = sum('total');
        const totalVES = toVes(totalUSD, rate.value);

        const paidAmount = paymentInput.amount !== undefined
          ? Number(paymentInput.amount)
          : (currency === 'VES' ? totalVES : totalUSD);
        if (!Number.isFinite(paidAmount) || paidAmount < 0) {
          throw badRequest('El monto pagado no es válido.', { field: 'payment.amount' });
        }

        const number = await nextSequence('VTA', session);

        const customerSnapshot = customer
          ? {
              id: String(customer._id),
              name: customer.name,
              documentType: customer.documentType,
              documentNumber: customer.documentNumber,
              email: customer.email || null,
              phone: customer.phone || null,
              creditBalanceBefore: round2(customer.credit?.balanceUSD || 0)
            }
          : {
              name: body.customerName || 'Consumidor final',
              documentType: customerRUT ? (customerRUT.includes('-') && customerRUT.split('-').length === 3 ? 'RIF' : 'CI') : null,
              documentNumber: customerRUT || null,
              email: body.customerEmail || null,
              phone: null,
              creditBalanceBefore: 0
            };

        const salePayload = {
          number,
          status: 'COMPLETED',
          customerId: customer?._id || null,
          customerRUT,
          paymentMethod,
          customerSnapshot,
          items: builtItems,
          totals: {
            subtotal: money(subtotalUSD, 'USD'),
            discount: money(discountUSD, 'USD'),
            taxableBase: money(baseUSD, 'USD'),
            iva: money(ivaUSD, 'USD'),
            total: money(totalUSD, 'USD'),
            totalInVES: money(totalVES, 'VES', rateSnap),
            paid: money(paidAmount, currency, currency === 'VES' ? rateSnap : null),
            change: money(paidAmount - (currency === 'VES' ? totalVES : totalUSD), currency, currency === 'VES' ? rateSnap : null)
          },
          exchangeSnapshot: rateSnap,
          payment: {
            method: payment.internal,
            label: paymentMethod,
            reference: paymentInput.reference || null,
            currency
          },
          invoice: null,
          audit: {
            sellerId: req.user.id,
            sellerName: req.user.name,
            idempotencyKey: key,
            createdAt: new Date()
          }
        };

        if (payment.internal === 'CREDIT' && customer) {
          const newBalance = round2(customer.credit.balanceUSD + totalUSD);
          if (newBalance > customer.credit.limitUSD) {
            throw conflict('CREDIT_LIMIT_EXCEEDED', 'Límite de crédito excedido.', {
              userMessage: 'El cliente superó su límite de crédito disponible.',
              suggestion: 'Reduce el monto o selecciona otro método de pago.'
            });
          }
          await Customer.updateOne(
            { _id: customer._id },
            { $set: { 'credit.balanceUSD': newBalance } },
            { session }
          );
          salePayload.totals.paid = money(0, 'USD');
          salePayload.audit.creditBalanceAfter = newBalance;
        }

        const [sale] = await Sale.create([salePayload], { session });
        await IdempotencyRecord.updateOne(
          { key },
          { $set: { status: 'COMPLETED', saleId: sale._id } },
          { session }
        );
        recordCreated = false;
        saleDoc = sale;
      });
    } finally {
      await session.endSession();
    }

    // Efectos posteriores al commit (patrón outbox). No revierten la venta si fallan.
    try {
      await finalizeInvoice(req, saleDoc);
    } catch (error) {
      console.error('[INVOICE] No se pudo generar el PDF:', error.message);
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('sale:created', {
        saleId: String(saleDoc._id),
        number: saleDoc.number,
        total: saleDoc.totals.total
      });
      for (const item of saleDoc.items) emitStockEvents(io, item);
    }

    return created(res, serializeSale(saleDoc), 'Venta registrada correctamente.');
  } catch (error) {
    if (error.code === 11000 && String(error.message).includes('key')) {
      return next(conflict('IDEMPOTENCY_CONFLICT', 'Clave de idempotencia duplicada.', {
        userMessage: 'La operación ya fue registrada. No se descontó stock dos veces.',
        suggestion: 'Consulta el historial de ventas.'
      }));
    }
    if (key && recordCreated) {
      try {
        await IdempotencyRecord.updateOne(
          { key },
          { $set: { status: 'FAILED', error: error.message } }
        );
      } catch (logError) {
        console.error('[IDEMPOTENCY] No se pudo registrar el fallo:', logError.message);
      }
    }
    return next(error);
  }
}

export async function listSales(req, res, next) {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.customerId && mongoose.isValidObjectId(req.query.customerId)) filter.customerId = req.query.customerId;
    if (req.query.sellerId) filter['audit.sellerId'] = req.query.sellerId;

    if (req.query.from || req.query.to) {
      filter['audit.createdAt'] = {};
      if (req.query.from) filter['audit.createdAt'].$gte = new Date(req.query.from);
      if (req.query.to) filter['audit.createdAt'].$lte = new Date(req.query.to);
    }

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const total = await Sale.countDocuments(filter);
    const docs = await Sale.find(filter)
      .sort({ 'audit.createdAt': -1 })
      .skip((Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit)))
      .limit(Math.min(100, Math.max(1, limit)))
      .lean();

    return ok(res, {
      data: docs.map(serializeSale),
      message: 'Ventas obtenidas correctamente.',
      meta: { pagination: paginate({ page, limit, total }) }
    });
  } catch (error) {
    return next(error);
  }
}

export async function downloadInvoice(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Venta');
    const sale = await Sale.findById(req.params.id).lean();
    if (!sale) throw notFound('Venta');
    const file = await ensureInvoiceFile(sale);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    return res.send(file.buffer);
  } catch (error) {
    return next(error);
  }
}

export async function getSale(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Venta');
    const sale = await Sale.findById(req.params.id).lean();
    if (!sale) throw notFound('Venta');
    return ok(res, { data: serializeSale(sale) });
  } catch (error) {
    return next(error);
  }
}

export async function voidSale(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Venta');
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 4) {
      throw badRequest('Se requiere un motivo de anulación.', { field: 'reason' });
    }

    const sale = await Sale.findById(req.params.id);
    if (!sale) throw notFound('Venta');
    if (sale.status === 'VOID') {
      throw conflict('INVALID_STATUS', 'La venta ya está anulada.', {
        userMessage: 'Esta venta ya fue anulada.',
        suggestion: 'Consulta el historial de notas de crédito.'
      });
    }

    const hours = (Date.now() - new Date(sale.audit.createdAt).getTime()) / 3_600_000;
    if (hours > VOID_WINDOW_HOURS && req.user.role !== 'FINANCE') {
      throw conflict('VOID_WINDOW_CLOSED', 'Fuera del plazo de anulación.', {
        userMessage: 'El plazo para anular sin aprobación terminó.',
        suggestion: 'Solicita aprobación a Finanzas.'
      });
    }

    let creditBalanceAfter = null;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const item of sale.items) {
          await increaseStock({
            productId: item.productId,
            quantity: item.quantity,
            lot: item.lot,
            session,
            userId: req.user.id,
            saleId: sale._id,
            reason: 'SALE_VOID'
          });
        }

        if (sale.customerId && sale.payment?.method === 'CREDIT') {
          // Leer el saldo real dentro de la transacción: el snapshot nunca guardó este valor.
          const customer = await Customer.findOne({ _id: sale.customerId }).session(session).lean();
          if (customer) {
            creditBalanceAfter = round2(
              Math.max(0, Number(customer.credit?.balanceUSD || 0) - sale.totals.total.amount)
            );
            await Customer.updateOne(
              { _id: sale.customerId },
              { $set: { 'credit.balanceUSD': creditBalanceAfter } },
              { session }
            );
          }
        }

        sale.status = 'VOID';
        sale.audit.voidedAt = new Date();
        sale.audit.voidReason = reason;
        if (creditBalanceAfter !== null) sale.audit.creditBalanceAfter = creditBalanceAfter;
        await sale.save({ session });
      });
    } finally {
      await session.endSession();
    }

    // La factura ya entregada debe dejar de decir COMPLETED.
    try {
      await finalizeInvoice(req, sale, 'invoice:voided');
    } catch (error) {
      console.error('[INVOICE] No se pudo regenerar la factura anulada:', error.message);
    }

    const io = req.app.get('io');
    if (io && sale.audit?.sellerId) {
      io.to(`user:${String(sale.audit.sellerId)}`).emit('sale:voided', {
        saleId: String(sale._id),
        status: 'VOID'
      });
    }

    return ok(res, { data: serializeSale(sale), message: 'Venta anulada y stock restaurado.' });
  } catch (error) {
    return next(error);
  }
}

export async function resendInvoice(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Venta');
    const sale = await Sale.findById(req.params.id).lean();
    if (!sale) throw notFound('Venta');

    const to = sale.customerSnapshot?.email;
    if (!to) {
      throw badRequest('El cliente no tiene correo registrado.', {
        field: 'email',
        userMessage: 'No hay correo electrónico para enviar la factura.',
        suggestion: 'Actualiza los datos del cliente.'
      });
    }

    const file = await ensureInvoiceFile(sale);
    const invoiceNumber = file.fileName.replace(/\.pdf$/, '');
    const result = await sendInvoice({
      to,
      subject: `Factura ${invoiceNumber}`,
      fileName: file.fileName,
      pdfBuffer: file.buffer
    });

    console.log('[MAIL]', JSON.stringify({
      saleId: String(sale._id),
      invoiceNumber,
      channel: result.channel,
      sent: result.sent,
      queued: result.queued
    }));

    return ok(res, {
      status: 202,
      data: {
        queued: result.queued,
        sent: result.sent,
        channel: result.channel,
        queueFile: result.queueFile || null,
        pdfUrl: file.relativeUrl
      },
      message: result.sent ? 'Factura enviada correctamente.' : 'Factura encolada para envío posterior.'
    });
  } catch (error) {
    return next(error);
  }
}
