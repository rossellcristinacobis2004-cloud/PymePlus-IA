# Historial de decisiones de diseño — PymePlus IA

> Registro obligatorio según `AGENTS.md` §8. Cada decisión de arquitectura debe anotarse aquí con fecha, contexto y consecuencias.

---

## ADR-001 — 2026-11-23: Definición del contexto funcional del sistema

**Estado:** Aceptada

**Contexto:** El repositorio contenía archivos placeholder en `/context/` sin especificación funcional. Se requirió formalizar producto, contratos y reglas de negocio antes de escribir código.

**Decisión:** Crear `context/system_context.md`, `context/api_contracts.md` y `context/business_rules.md` como fuentes de verdad de producto, API y cálculo respectivamente.

**Consecuencias:** Todo módulo `/api/<modulo>/` debe ajustarse a dichos contratos. Los cambios de semántica requieren nueva versión del documento y entrada en este registro.

---

## ADR-002 — 2026-11-23: USD como moneda base, VES derivada de BCV

**Estado:** Aceptada

**Contexto:** El comercio venezolano opera en doble moneda con tasas divergentes y documentos fiscales que exigen la tasa oficial.

**Decisión:** Persistir costos y reportes históricos en USD; derivar VES con la tasa oficial del BCV y almacenar un `rateSnapshot` inmutable en cada transacción. Tasa paralela solo informativa.

**Consecuencias:** Los reportes con `valuationMode=historical` usan el snapshot original; el modo `current` revalúa. Se requiere un servicio de captura diaria con fallback y bandera `isFallback`.

---

## ADR-003 — 2026-11-23: IVA 16 % por línea y redondeo HALF_UP

**Estado:** Aceptada

**Contexto:** Se necesita un cálculo fiscal predecible y auditable para facturas PDF.

**Decisión:** IVA general 16 %, exento 0 % con certificado; cálculo por línea, descuento antes de impuesto, redondeo a 2 decimales al final de cada línea. IGTF queda como extensión futura vía `taxes[]`.

**Consecuencias:** El servidor recalcula siempre los importes; el cliente nunca envía totales. Los totales son suma de líneas ya redondeadas.

---

## ADR-004 — 2026-11-23: Descuento de stock condicional y transaccional

**Estado:** Aceptada

**Contexto:** Ventas concurrentes sobre el último artículo podían generar stock negativo o pérdida de actualizaciones.

**Decisión:** Actualizaciones condicionales de Mongoose (`filtro stock.available >= cantidad` + `$inc`) dentro de una transacción con `readConcern: snapshot` y `writeConcern: majority`, con idempotencia por clave yAuditoría `InventoryMovement`. Efectos secundarios (PDF,Socket.IO, correo) fuera de la transacción mediante patrón outbox.

**Consecuencias:** MongoDB debe desplegarse como replica set. Se prohíbe el patrón leer-verificar-escribir en memoria.

---

## ADR-005 — 2026-11-23: Inicialización del backend Node 26 + Express 5 ESM

**Estado:** Aceptada

**Contexto:** `projects/backend` contenía una plantilla sin `package.json`, sin `index.js` y sin dependencias instaladas.

**Decisión:** Crear `package.json` con `"type": "module"` y dependencias exactas pedidas (express 5.3, mongoose 9.13, dotenv 18, cors 2.8, helmet 8.3, jsonwebtoken 9, bcryptjs 3, express-fileupload 1.6, socket.io 4.8). Adaptar `bin/server.js` con healthcheck `/api/health`, 404 JSON para `/api`, manejador global de errores legibles, límite de 10 MB y `os.tmpdir()` para compatibilidad Windows. `index.js` carga `.env` primero y gestiona cierre graceful.

**Consecuencias:** El servidor arranca sin MongoDB definido (modo degradado con advertencia). La ruta SPA `/*path` usa sintaxis Express 5. Falta implementar los enrutadores de dominio y la conexión obligatoria a MongoDB en producción.

---

## ADR-006 — 2026-11-23: Campos públicos aditivos y eventos de stock duales

**Estado:** Aceptada

**Contexto:** El contrato solicitado para producto (`sku`, `category`, `costUSD`, `priceUSD`, `stockCurrent`, `stockMinimum`, `imageUrl`, `isActive`) y facturación (`invoiceNumber`, `customerRUT`, `totalUSD`, `totalVES`, `exchangeRate`, `paymentMethod`) difería del storage histórico anidado. Además, el frontend ya escuchaba `stock:updated`.

**Decisión:** Exponer los campos nuevos como virtuales/alias calculados sobre `pricing`, `stock`, `flags`, `totals` e `invoice` (una sola fuente de verdad). Categoría migrada a `String` con enum acotado mediante script no destructivo. Emitir simultáneamente `stock_updated` y `stock:updated` con idéntico payload. Correo con webhook si `MAIL_WEBHOOK_URL` existe; si no, encolar en `microservices/outbox/` sin afirmar envío. Tasa BCV se carga manualmente desde `/api/exchange-rates` con snapshot por venta; sin scraper externo.

**Consecuencias:** Los clientes actuales siguen funcionando sin cambios; los nuevos reciben ambos formatos. La bandera `queued/sent` distingue correo encolado de correo realmente enviado. Se agregaron rate limit en login/ventas, refresh token, recuperación de contraseña, Docker y GitHub Actions.

---

## ADR-007 — 2026-11-23: Comprobante PDF canónico y autorización de precios por rol

**Estado:** Aceptada

**Contexto:** `helpers/pdf.js` mezclaba el constructor PDF con la factura, mostraba `VTA-...` en vez de `FAC-...`, escribía `IVA (16%)` fijo, truncaba a 55 líneas y no regeneraba archivos existentes. `invoice:ready` estaba en el contrato pero nunca se emitía. Por otro lado, `PATCH /api/products/:id` permitía a `WAREHOUSE` cambiar `priceUSD` y `POST /api/products` le permitía fijar precio al crear.

**Decisión:** Crear `helpers/pdf-invoice.js` como única fuente del comprobante (`generateInvoicePdf`, `invoiceFileName`, `invoicePdf`), con número `FAC`, alícuota real por línea, RUT, método de pago, control, tasa BCV con fecha/fuente y leyenda de fallback; `createSimplePdf` pasa a paginar automáticamente. `ensureInvoiceFile()` regenera siempre el PDF y emite `invoice:ready` fuera de la transacción. Crear `middlewares/auth.middleware.js` como implementación canónica (`requireAuth`, `requireRole`, `requireAdmin`, `requirePricePermission`), dejando `auth.js` como re-export. `POST /api/products` queda solo para `ADMIN` porque la creación exige `priceUSD`; `PATCH` filtra por campos de precio y preserva edición no monetaria para almacén. `ADMIN` sigue siendo el valor persistido; `Administrador` se acepta solo como alias entrante, sin migración de MongoDB.

**Consecuencias:** No se duplica lógica JWT ni se migran roles. Un token de refresh no sirve como access token. Los cambios de plantilla se reflejan de inmediato porque el PDF se regenera. La tasa BCV sigue siendo competencia de `ADMIN`/`FINANCE`: no es precio de producto y no se tocó esa regla.
