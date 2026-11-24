import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';

import Sale from './sale.model.js';
import IdempotencyRecord from './idempotency-record.model.js';
import Product from '../products/product.model.js';
import Customer from '../customers/customer.model.js';

import { ok, created, paginate, nowIso } from '../../helpers/response.js';
import { badRequest, conflict, forbidden, notFound } from '../../helpers/errors.js';
import { money, round2, toVes } from '../../helpers/money.js';
import { calculateLine, resolveTaxType } from '../../helpers/tax.js';
import { resolvePayment } from '../../helpers/payment.js';
import {
  parseCustomerRUT,
  validateDocument,
  validateEmail,
  requireString,
  positiveInt,
  dateParam
} from '../../helpers/validators.js';
import { getActiveRate, assertCurrencyAllowed, snapshot } from '../../services/exchange-rate.service.js';
import { decrementStock, increaseStock, nextSequence } from '../../services/inventory.service.js';
import { serializeSale } from '../../helpers/serializers.js';
import { generateInvoicePdf, invoiceFileName } from '../../helpers/pdf-invoice.js';
import { sendInvoice } from '../../microservices/email.connector.js';

// Fuera del árbol servido por /uploads: los PDF contienen datos fiscales.
const INVOICE_DIR = path.resolve(process.cwd(), 'var/invoices');
const VOID_WINDOW_HOURS = Number(process.env.VOID_WINDOW_HOURS || 24);
const SALES_MANAGER_ROLES = ['ADMIN', 'SUPERVISOR', 'FINANCE'];

/** Los eventos de negocio solo llegan a sockets con JWT válido. */
function emitToAuthenticated(io, event, payload) {
  if (io) io.to('authenticated').emit(event, payload);
}

function canManageSales(user) {
  return SALES_MANAGER_ROLES.includes(user?.role);
}

/** Admin/Supervisor/Finanzas ven todo; Cajero solo sus ventas; Almacén ninguna. */
function assertSaleAccess(req, sale) {
  if (canManageSales(req.user)) return;
  if (req.user?.role === 'CASHIER' && String(sale.audit?.sellerId) === String(req.user.id)) return;
  throw forbidden('No tienes permiso para acceder a esta venta.', {
    userMessage: 'Esta venta no pertenece a tu usuario.',
    suggestion: 'Solicita permiso a un supervisor o administrador.'
  });
}

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
  if (items.length > 200) {
    throw badRequest('La venta tiene demasiados productos.', {
      field: 'items',
      userMessage: 'La venta supera el máximo de 200 líneas.',
      suggestion: 'Divide la operación en dos ventas.'
    });
  }

  return items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw badRequest('Cada producto de la venta no es válido.', { field: `items[${index}]` });
    }
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

function emitStockEvents(io, item, { delta = -item.quantity, reason = 'SALE_OUT' } = {}) {
  if (!io) return;

  // Contrato nuevo y contrato histórico: mismo dato, dos nombres de evento.
  const productData = {
    id: String(item.productId),
    productId: String(item.productId),
    sku: item.sku,
    name: item.name,
    stockCurrent: item.stockAfter,
    available: item.stockAfter,
    delta,
    reason
  };

  emitToAuthenticated(io, 'stock_updated', productData);
  emitToAuthenticated(io, 'stock:updated', productData);
}

/** Reintento con la misma clave: devuelve la venta original y repara su factura. */
async function replayCompletedSale(req, res, existing) {
  let previous = await Sale.findById(existing.saleId).lean();
  if (!previous) return null;

  if (!previous.invoice) {
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

/** El documento viene sin tipo explícito en el contrato histórico (customerRUT). */
function inferDocumentType(documentNumber) {
  const text = String(documentNumber || '').toUpperCase();
  if (/^[JGVPE]-\d{8}-\d$/.test(text)) return 'RIF';
  if (/^[VE]-\d{7,8}$/.test(text)) return 'CI';
  return 'PASSPORT';
}

/**
 * Toda venta debe tener un cliente identificado. Si el front envía customerId se
 * usa ese registro; si no, se exige nombre + documento y se da de alta al cliente.
 * El alta ocurre antes de la transacción: no bloquea ni revierte el stock.
 */
async function resolveSaleCustomer(body, paymentInternal) {
  let customer;

  if (body.customerId) {
    if (!mongoose.isValidObjectId(body.customerId)) {
      throw badRequest('Cliente inválido.', { field: 'customerId' });
    }
    customer = await Customer.findOne({ _id: body.customerId, active: true }).lean();
    if (!customer) throw notFound('Cliente');
  } else {
    const name = requireString(body.customerName ?? body.name, 'customerName', { min: 2, max: 120 });
    const rawType = body.customerDocumentType ?? body.documentType;
    const rawNumber = body.customerDocumentNumber ?? body.documentNumber ?? body.customerRUT;
    if (!rawNumber) {
      throw badRequest('La venta requiere el documento del cliente.', {
        field: 'documentNumber',
        userMessage: 'Para facturar necesitas el documento del cliente.',
        suggestion: 'Ingresa un RIF, cédula o pasaporte válido.'
      });
    }

    const document = rawType
      ? validateDocument(rawType, rawNumber)
      : (() => {
          const documentNumber = parseCustomerRUT(rawNumber);
          return { documentType: inferDocumentType(documentNumber), documentNumber };
        })();

    const email = body.customerEmail ? validateEmail(body.customerEmail) : null;
    const phone = body.customerPhone ? String(body.customerPhone).trim().slice(0, 50) || null : null;

    customer = await Customer.findOne({ documentNumber: document.documentNumber }).lean();
    if (customer && customer.active === false) {
      throw conflict('INACTIVE_CUSTOMER', 'El cliente está dado de baja.', {
        userMessage: 'Ese documento pertenece a un cliente dado de baja.',
        suggestion: 'Verifica el documento o registra un cliente nuevo.'
      });
    }

    if (!customer) {
      try {
        customer = await Customer.create({
          name,
          documentType: document.documentType,
          documentNumber: document.documentNumber,
          email,
          phone
        });
      } catch (error) {
        // Carrera de dos cajeros dando de alta el mismo documento: se reutiliza el registro.
        if (error.code !== 11000) throw error;
        customer = await Customer.findOne({ documentNumber: document.documentNumber }).lean();
        if (!customer) throw error;
      }
    }
  }

  if (paymentInternal === 'CREDIT' && !customer.credit?.enabled) {
    throw conflict('CREDIT_LIMIT_EXCEEDED', 'El cliente no tiene crédito habilitado.', {
      userMessage: 'El cliente no tiene crédito habilitado.',
      suggestion: 'Selecciona otro método de pago.'
    });
  }

  return customer;
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
        const replayed = await replayCompletedSale(req, res, existing);
        if (replayed) return replayed;
        // El registro quedó huérfano: se descarta para permitir un reintento limpio.
        await IdempotencyRecord.deleteOne({ _id: existing._id });
      }
      throw conflict('TRANSACTION_CONFLICT', 'La operación aún está en proceso.', {
        userMessage: 'Otra operación está en curso. Espera un momento e inténtalo de nuevo.',
        suggestion: 'Reintenta en unos segundos.',
        retryable: true
      });
    }

    const body = req.body || {};
    const items = validateItems(body.items);
    if (body.customerEmail !== undefined && body.customerEmail !== null && body.customerEmail !== '') {
      validateEmail(body.customerEmail);
    }
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

    const customer = await resolveSaleCustomer(body, payment.internal);
    const customerRUT = parseCustomerRUT(customer.documentNumber);
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

        const isCredit = payment.internal === 'CREDIT';
        const amountDue = currency === 'VES' ? totalVES : totalUSD;
        const paidAmount = isCredit
          ? 0
          : paymentInput.amount !== undefined
            ? Number(paymentInput.amount)
            : amountDue;
        if (!Number.isFinite(paidAmount) || paidAmount < 0) {
          throw badRequest('El monto pagado no es válido.', { field: 'payment.amount' });
        }

        const number = await nextSequence('VTA', session);

        const customerSnapshot = {
          id: String(customer._id),
          name: customer.name,
          documentType: customer.documentType,
          documentNumber: customer.documentNumber,
          email: customer.email || null,
          phone: customer.phone || null,
          creditBalanceBefore: round2(customer.credit?.balanceUSD || 0)
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
            change: money(isCredit ? 0 : round2(paidAmount - amountDue), currency, currency === 'VES' ? rateSnap : null)
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

        if (isCredit && customer) {
          // Condicionamos al saldo leído: dos ventas simultáneas no pueden perder
          // una actualización ni superar el límite de crédito.
          const currentBalance = round2(Number(customer.credit?.balanceUSD || 0));
          const newBalance = round2(currentBalance + totalUSD);
          const creditUpdate = await Customer.updateOne(
            {
              _id: customer._id,
              'credit.balanceUSD': currentBalance,
              'credit.limitUSD': { $gte: newBalance }
            },
            { $set: { 'credit.balanceUSD': newBalance } },
            { session }
          );
          if (creditUpdate.matchedCount !== 1) {
            throw conflict('CREDIT_LIMIT_EXCEEDED', 'Límite de crédito excedido.', {
              userMessage: 'El cliente superó su límite de crédito disponible.',
              suggestion: 'Reduce el monto, revisa el saldo o selecciona otro método de pago.'
            });
          }
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
      emitToAuthenticated(io, 'sale:created', {
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
      // No dejamos un registro FAILED que bloquee todos los reintentos futuros:
      // la venta no se persistió, así que la clave vuelve a estar disponible.
      try {
        await IdempotencyRecord.deleteOne({ key, status: 'PENDING' });
      } catch (logError) {
        console.error('[IDEMPOTENCY] No se pudo liberar la clave:', logError.message);
      }
    }
    return next(error);
  }
}

export async function listSales(req, res, next) {
  try {
    const filter = {};
    if (req.query.status) {
      const status = String(req.query.status).toUpperCase();
      if (!['COMPLETED', 'VOID'].includes(status)) {
        throw badRequest('Estado de venta no válido.', { field: 'status' });
      }
      filter.status = status;
    }
    if (req.query.customerId) {
      if (!mongoose.isValidObjectId(req.query.customerId)) {
        throw badRequest('Cliente no válido.', { field: 'customerId' });
      }
      filter.customerId = req.query.customerId;
    }

    if (canManageSales(req.user)) {
      if (req.query.sellerId) {
        if (!mongoose.isValidObjectId(req.query.sellerId)) {
          throw badRequest('Vendedor no válido.', { field: 'sellerId' });
        }
        filter['audit.sellerId'] = req.query.sellerId;
      }
    } else if (req.user?.role === 'CASHIER') {
      // Un cajero jamás puede consultar las ventas de otro usuario.
      filter['audit.sellerId'] = req.user.id;
    } else {
      throw forbidden('No tienes permiso para consultar ventas.', {
        userMessage: 'Tu perfil no puede consultar el historial de ventas.',
        suggestion: 'Solicita acceso a un supervisor.'
      });
    }

    const from = dateParam(req.query.from, 'from');
    const to = dateParam(req.query.to, 'to');
    if (from && to && from > to) {
      throw badRequest('La fecha desde no puede ser mayor que la fecha hasta.', { field: 'from' });
    }
    if (from || to) {
      filter['audit.createdAt'] = {};
      if (from) filter['audit.createdAt'].$gte = from;
      if (to) filter['audit.createdAt'].$lte = to;
    }

    const page = positiveInt(req.query.page, 'page', 1);
    const limit = positiveInt(req.query.limit, 'limit', 20);
    const total = await Sale.countDocuments(filter);
    const docs = await Sale.find(filter)
      .sort({ 'audit.createdAt': -1 })
      .skip((page - 1) * limit)
      .limit(limit)
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
    assertSaleAccess(req, sale);
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
    assertSaleAccess(req, sale);
    return ok(res, { data: serializeSale(sale) });
  } catch (error) {
    return next(error);
  }
}

export async function voidSale(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Venta');
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 4 || reason.length > 500) {
      throw badRequest('Se requiere un motivo de anulación de 4 a 500 caracteres.', { field: 'reason' });
    }

    const role = req.user.role;
    if (!SALES_MANAGER_ROLES.includes(role)) {
      throw forbidden('Solo Administración, Supervisión o Finanzas pueden anular ventas.', {
        userMessage: 'Tu perfil no puede anular ventas.',
        suggestion: 'Solicita la intervención de un supervisor o administrador.'
      });
    }

    const sale = await Sale.findById(req.params.id);
    if (!sale) throw notFound('Venta');
    assertSaleAccess(req, sale);
    if (sale.status === 'VOID') {
      throw conflict('INVALID_STATUS', 'La venta ya está anulada.', {
        userMessage: 'Esta venta ya fue anulada.',
        suggestion: 'Consulta el historial de notas de crédito.'
      });
    }
    if (sale.status !== 'COMPLETED') {
      throw conflict('INVALID_STATUS', 'La venta no se puede anular.', {
        userMessage: 'Esta venta no está en un estado que permita anularla.',
        suggestion: 'Revisa el estado de la venta.'
      });
    }

    const createdAt = new Date(sale.audit?.createdAt || sale.createdAt);
    const hours = Number.isNaN(createdAt.getTime())
      ? 0
      : (Date.now() - createdAt.getTime()) / 3_600_000;
    if (hours > VOID_WINDOW_HOURS && role !== 'FINANCE') {
      throw conflict('VOID_WINDOW_CLOSED', 'Fuera del plazo de anulación.', {
        userMessage: 'El plazo para anular sin aprobación terminó.',
        suggestion: 'Solicita aprobación a Finanzas.'
      });
    }

    let creditBalanceAfter = null;
    const restoredItems = [];
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        restoredItems.length = 0;
        creditBalanceAfter = null;

        // Reclamo atómico de la anulación: dos peticiones concurrentes no pueden
        // restaurar el stock dos veces.
        const claimed = await Sale.updateOne(
          { _id: sale._id, status: 'COMPLETED' },
          {
            $set: {
              status: 'VOID',
              'audit.voidedAt': new Date(),
              'audit.voidReason': reason,
              'audit.voidedBy': req.user.id
            }
          },
          { session }
        );
        if (claimed.matchedCount !== 1) {
          throw conflict('INVALID_STATUS', 'La venta ya está anulada.', {
            userMessage: 'Esta venta ya fue anulada por otro usuario.',
            suggestion: 'Consulta el historial de notas de crédito.'
          });
        }

        for (const item of sale.items) {
          const restored = await increaseStock({
            productId: item.productId,
            quantity: item.quantity,
            lot: item.lot,
            session,
            userId: req.user.id,
            saleId: sale._id,
            reason: 'SALE_VOID'
          });
          restoredItems.push({
            productId: item.productId,
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            stockAfter: restored.stock.available
          });
        }

        if (sale.customerId && sale.payment?.method === 'CREDIT') {
          // Leer y actualizar el saldo real dentro de la transacción.
          const customer = await Customer.findOne({ _id: sale.customerId }).session(session).lean();
          if (customer) {
            const currentBalance = round2(Number(customer.credit?.balanceUSD || 0));
            creditBalanceAfter = round2(Math.max(0, currentBalance - sale.totals.total.amount));
            const creditUpdate = await Customer.updateOne(
              { _id: sale.customerId, 'credit.balanceUSD': currentBalance },
              { $set: { 'credit.balanceUSD': creditBalanceAfter } },
              { session }
            );
            if (creditUpdate.matchedCount !== 1) {
              throw conflict('TRANSACTION_CONFLICT', 'El saldo del cliente cambió durante la anulación.', {
                userMessage: 'El saldo del cliente cambió. Inténtalo de nuevo.',
                suggestion: 'Reintenta la anulación.',
                retryable: true
              });
            }
            await Sale.updateOne(
              { _id: sale._id },
              { $set: { 'audit.creditBalanceAfter': creditBalanceAfter } },
              { session }
            );
          }
        }
      });
    } finally {
      await session.endSession();
    }

    sale.status = 'VOID';
    sale.audit.voidedAt = new Date();
    sale.audit.voidedBy = req.user.id;
    if (creditBalanceAfter !== null) sale.audit.creditBalanceAfter = creditBalanceAfter;

    // La factura ya entregada debe dejar de decir COMPLETED.
    try {
      await finalizeInvoice(req, sale, 'invoice:voided');
    } catch (error) {
      console.error('[INVOICE] No se pudo regenerar la factura anulada:', error.message);
    }

    const io = req.app.get('io');
    if (io) {
      const payload = { saleId: String(sale._id), status: 'VOID' };
      if (sale.audit?.sellerId) io.to(`user:${String(sale.audit.sellerId)}`).emit('sale:voided', payload);
      for (const managerRole of SALES_MANAGER_ROLES) {
        io.to(`role:${managerRole}`).emit('sale:voided', payload);
      }
      for (const item of restoredItems) {
        emitStockEvents(io, item, { delta: item.quantity, reason: 'SALE_VOID' });
      }
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
    assertSaleAccess(req, sale);

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
