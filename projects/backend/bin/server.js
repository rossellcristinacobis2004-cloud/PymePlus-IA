import crypto from 'crypto';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import os from 'os';
import cors from 'cors';
import helmet from 'helmet';
import fileUpload from 'express-fileupload';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { connectDatabase, databaseState } from '../databases/mongodb.js';
import { normalizeError } from '../helpers/errors.js';
import { nowIso } from '../helpers/response.js';
import authRoutes from '../api/auth/auth.routes.js';
import productRoutes from '../api/products/products.routes.js';
import saleRoutes from '../api/sales/sales.routes.js';
import customerRoutes from '../api/customers/customers.routes.js';
import reportRoutes from '../api/reports/reports.routes.js';
import exchangeRateRoutes from '../api/exchange-rates/exchange-rate.routes.js';
import { salesLimiter } from '../middlewares/rate-limit.js';
import { createMarketRateJob } from '../services/market-rate.job.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BODY_LIMIT = process.env.BODY_LIMIT || '10mb';
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024;

/** TRUST_PROXY por defecto desactivado: solo se confía si se configura explícitamente. */
function resolveTrustProxy() {
  const value = process.env.TRUST_PROXY;
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : false;
}

function assertProductionSecrets() {
  if (process.env.NODE_ENV !== 'production') return;
  for (const name of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    const secret = process.env[name] || '';
    if (secret.length < 32) {
      throw new Error(`${name} debe tener al menos 32 caracteres en producción.`);
    }
  }
}

/** Pathname decodificado: express.static decodifica, app.use() no. */
function safePathname(req) {
  const raw = (req.originalUrl || req.url || '').split('?')[0];
  try {
    // URL() normaliza "%2e%2e" a ".." y colapsa segmentos antes de que podamos
    // inspeccionarlos: se detecta primero sobre la cadena original.
    if (/%2e|%2f|%5c|\.\.|\\/i.test(raw)) return null;
    return decodeURIComponent(new URL(raw, 'http://localhost').pathname)
      .replace(/\\/g, '/')
      .toLowerCase();
  } catch {
    return null;
  }
}

class WebServer {
  constructor() {
    assertProductionSecrets();
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: { origin: this.#corsOrigin(), credentials: true },
      path: process.env.SOCKET_IO_PATH || '/socket.io'
    });

    this.app.set('io', this.io);
    this.app.set('trust proxy', resolveTrustProxy());
    this.app.disable('x-powered-by');

    this.marketRateJob = null;

    this.database();
    this.middlewares();
    this.routes();
    this.publics();
    this.errors();
  }

  /** Origen(es) permitidos: `true` (todos) o lista separada por comas. */
  #corsOrigin() {
    const configured = process.env.CORS_ORIGIN;
    if (!configured || configured === '*') return true;

    const origins = configured
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    return origins.length === 1 ? origins[0] : origins;
  }

  /** Conexión opcional a MongoDB; el servidor arranca aunque no haya URI. */
  database() {
    connectDatabase()
      .then(() => this.#startMarketRateJob())
      .catch((error) => {
        console.error('[DB] Error al conectar MongoDB:', error.message);
      });
  }

  /** Refresco de tasa de mercado: arranca después de la conexión a MongoDB. */
  #startMarketRateJob() {
    if (this.marketRateJob) return;
    this.marketRateJob = createMarketRateJob({ io: this.io });
    this.marketRateJob.start();
  }

  middlewares() {
    // Toda respuesta (incluida la de error) lleva un requestId trazable.
    this.app.use((req, res, next) => {
      const incoming = String(req.headers['x-request-id'] || '').slice(0, 100);
      req.requestId = incoming || crypto.randomUUID();
      res.setHeader('X-Request-Id', req.requestId);
      return next();
    });

    // Cabeceras de seguridad. CSP desactivado: la SPA Angular se sirve desde el mismo origen.
    this.app.use(helmet({ contentSecurityPolicy: false }));
    this.app.use(cors({ origin: this.#corsOrigin(), credentials: true }));

    // Límite de 10 MB para JSON y formularios.
    this.app.use(express.json({ limit: BODY_LIMIT }));
    this.app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

    // Subida de archivos (PDF, imágenes, APK) con límite de 10 MB.
    // os.tmpdir() garantiza compatibilidad Windows/Linux (AGENTS.md usa /tmp/ como ejemplo).
    this.app.use(
      fileUpload({
        useTempFiles: true,
        tempFileDir: path.join(os.tmpdir(), 'pymeplus-ia'),
        createParentPath: true,
        limits: { fileSize: MAX_FILE_SIZE }
      })
    );
  }

  routes() {
    /** Endpoint de salud: útil para PM2, balanceadores y despliegue. */
    this.app.get('/api/health', (_req, res) => {
      res.status(200).json({
        success: true,
        message: 'Servicio operativo.',
        data: {
          app: process.env.APP_NAME || 'PymePlus IA',
          environment: process.env.NODE_ENV || 'development',
          uptimeSeconds: Math.round(process.uptime()),
          database: databaseState()
        },
        meta: {
          timestamp: nowIso(),
          timezone: process.env.TIMEZONE || 'America/Caracas'
        },
        errors: []
      });
    });

    // Enrutadores del dominio.
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/products', productRoutes);
    this.app.use('/api/sales', salesLimiter, saleRoutes);
    this.app.use('/api/customers', customerRoutes);
    this.app.use('/api/reports', reportRoutes);
    this.app.use('/api/exchange-rates', exchangeRateRoutes);

    // Handshake opcional: sin token se permite la conexión (health/smoke), pero no
    // se une a ninguna sala privada. Los eventos de factura solo van a su sala.
    this.io.use((socket, next) => {
      const token =
        socket.handshake.auth?.token ||
        String(socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');

      if (token && process.env.JWT_SECRET) {
        try {
          const payload = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ['HS256']
          });
          if (payload.sub && payload.type !== 'refresh') {
            socket.data.userId = String(payload.sub);
            socket.data.role = payload.role === 'Administrador' ? 'ADMIN' : payload.role;
            socket.join('authenticated');
            socket.join(`user:${socket.data.userId}`);
            if (socket.data.role) socket.join(`role:${socket.data.role}`);
          }
        } catch {
          // Cliente invitado: se conecta sin salas privadas.
        }
      }
      return next();
    });

    this.io.on('connection', (socket) => {
      console.log(`[SOCKET] Cliente conectado: ${socket.id}`);
      socket.on('disconnect', () => console.log(`[SOCKET] Cliente desconectado: ${socket.id}`));
    });
  }

  publics() {
    const publicPath = path.join(__dirname, '../public');
    const uploadsPath = path.join(__dirname, '../uploads');

    // Las facturas contienen RUT, correo y montos: NO son estáticos públicos.
    // express.static decodifica la URL, pero app.use() compara el path sin decodificar:
    // por eso se valida también el pathname decodificado (%69, %2f, ..).
    this.app.use((req, res, next) => {
      const decoded = safePathname(req);
      if (decoded === null) return res.status(404).end();
      if (
        decoded.split('/').includes('..') ||
        decoded.includes('/uploads/documents/invoices') ||
        decoded.includes('/var/invoices')
      ) {
        return res.status(404).end();
      }
      return next();
    });

    // Solo directorios explícitamente públicos; documents/* nunca se sirve.
    this.app.use('/uploads/images', express.static(path.join(uploadsPath, 'images'), { index: false, fallthrough: true }));
    this.app.use('/uploads/apks', express.static(path.join(uploadsPath, 'apks'), { index: false, fallthrough: true }));
    this.app.use('/uploads/documents', (_req, res) => res.status(404).end());
    this.app.use('/uploads', express.static(uploadsPath, { index: false, fallthrough: true }));

    // Estáticos compilados de Angular.
    this.app.use(express.static(publicPath, { index: false }));

    // Una ruta /api desconocida debe responder JSON, no el index.html de la SPA.
    this.app.use('/api', (_req, res) => {
      res.status(404).json({
        success: false,
        message: 'Endpoint no encontrado.',
        userMessage: 'La función que intentas usar no está disponible.',
        data: null,
        meta: { timestamp: nowIso() },
        errors: [
          {
            code: 'NOT_FOUND',
            field: null,
            detail: 'No existe una ruta API para esta petición.',
            suggestion: 'Verifica la URL o actualiza la aplicación.',
            retryable: false
          }
        ]
      });
    });

    // Fallback SPA (sintaxis Express 5 / path-to-regexp v8).
    // Las llaves hacen que el comodín también coincida con la raíz '/'.
    this.app.get('/{*path}', (req, res, next) => {
      res.sendFile(path.resolve(publicPath, 'index.html'), (error) => {
        if (error) next(error);
      });
    });
  }

  /** Manejador global de errores con mensajes legibles para el usuario final. */
  errors() {
    this.app.use((error, req, res, _next) => {
      if (res.headersSent) return;

      const normalized = normalizeError(error);
      const isDuplicateKey = normalized.code === 11000;
      const status = normalized.status || normalized.statusCode || (isDuplicateKey ? 409 : 500);
      const isClientError = status < 500;

      if (!isClientError) {
        console.error('[ERROR]', error);
      }

      res.status(status).json({
        success: false,
        message: isClientError ? 'La solicitud no pudo procesarse.' : 'Ocurrió un error interno.',
        userMessage:
          normalized.userMessage ||
          (isDuplicateKey
            ? 'Ya existe un registro con ese identificador.'
            : isClientError
              ? normalized.message
              : 'No pudimos completar la operación. Inténtalo nuevamente.'),
        data: null,
        meta: {
          requestId: req.requestId || null,
          timestamp: nowIso(),
          timezone: process.env.TIMEZONE || 'America/Caracas'
        },
        errors: [
          {
            code: isDuplicateKey
              ? 'DUPLICATE_KEY'
              : normalized.code || (isClientError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'),
            field: normalized.field || null,
            // Un 500 nunca expone mensajes internos ni stack traces.
            detail: isClientError ? normalized.message : 'Error interno del servidor.',
            suggestion: normalized.suggestion || 'Revisa los datos e inténtalo de nuevo.',
            retryable: !isClientError
          }
        ]
      });
    });
  }

  listen() {
    // PORT=0 es válido para pruebas: el sistema asigna un puerto libre.
    const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 3500;
    const host = process.env.HOST || '0.0.0.0';

    this.server.listen(port, host, () => {
      console.log(`Servidor ejecutándose en http://${host}:${port}`);
      console.log(`Entorno: ${process.env.NODE_ENV || 'development'} · Socket.IO: ${this.io.path()}`);
    });

    return this.server;
  }

  /** Cierra Socket.IO y el servidor HTTP subyacente. */
  close() {
    this.marketRateJob?.stop();
    return new Promise((resolve) => this.io.close(resolve));
  }
}

export default WebServer;
