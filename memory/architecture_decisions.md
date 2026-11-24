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

---

## ADR-008 — 2026-11-23: Endurecimiento de facturas, sockets y JWT

**Estado:** Aceptada

**Contexto:** Auditoría posterior a ADR-007: `/uploads` servía los PDF con RUT, correo y montos sin autenticación; `invoice:ready` se emitía a todos los sockets incluyendo la URL del archivo; el correo releyó el disco con riesgo de carrera frente a descargas concurrentes; el reintento idempotente no reparaba una factura perdida; anular no regeneraba el comprobante y abusaba del evento `stock:updated`. Además `requireRole` no reconocía el alias `Administrador` y `jwt.verify` aceptaba tokens HS384/HS512 con el mismo secreto.

**Decisión:** Bloquear `/uploads/documents/invoices/*` con 404 y servir la factura solo por `GET /api/sales/:id/invoice.pdf` con JWT. Autenticar opcionalmente el handshake de Socket.IO y emitir eventos de factura únicamente a la sala `user:<sellerId>`, sin `pdfUrl`. `ensureInvoiceFile()` genera el `Buffer`, escribe con archivo temporal + `rename` atómico y reutiliza ese buffer en descarga y correo. Extraer `finalizeInvoice()` y aplicarlo en creación, reintento sin `invoice` y anulación (`invoice:voided` + `sale:voided`). Normalizar `Administrador` a `ADMIN` en `requireAuth` y fijar `algorithms: ['HS256']` en access y refresh.

**Consecuencias:** Un socket sin token se conecta como invitado pero no recibe eventos privados. La anulación ya no falsifica un evento de stock. `PATCH` acepta `pricing` anidado, eliminando el falso `200`. Se añadieron verificaciones de xref, algoritmos JWT, reparación por reintento, regeneración tras anulación, mismo buffer en correo y bloqueo de estáticos. Totales: 33 unitarias + 6 smoke + 49 integración.

---

## ADR-009 — 2026-11-23: Segunda auditoría — autorización por rol, concurrencia y entradas malformadas

**Estado:** Aceptada

**Contexto:** La verificación posterior a ADR-008 confirmó que aún existían fallos reales: cualquiera con JWT podía listar ventas, clientes y reportes; `resend-invoice` no verificaba propiedad; `items:[null]`, `batches:[null]`, `from=basura` y paginación inválida terminaban en 500; se podía vender un lote vencido; `increaseStock()` lanzaba `TypeError` si el lote faltaba; la aprobación `FINANCE` fuera de plazo era código muerto; dos ventas a crédito concurrentes podían perder una actualización y dos anulaciones concurrentes podían restaurar stock dos veces; los tokens de recuperación crecían sin límite; `TRUST_PROXY=1` y secretos JWT corteros eran inseguros por defecto.

**Decisión:** Centralizar la autorización de lectura: `ADMIN`/`SUPERVISOR`/`FINANCE` ven todo, `CASHIER` queda forzado a `audit.sellerId` y `WAREHOUSE` recibe 403 en ventas, clientes, reportes y tasas. La anulación usa `updateOne({ status: 'COMPLETED' })` condicional y emite `stock_updated`/`stock:updated` con `delta > 0` y `reason: SALE_VOID` sobre lotes reales. El crédito usa `updateOne` condicional sobre `credit.balanceUSD` y `credit.limitUSD`, con `paid=0`/`change=0`. Se añade `normalizeError()` para CastError/ValidationError/JSON/payload grande, validadores `requireNumber`/`positiveInt`/`dateParam`/`PASSPORT_RE`, revalidación de rol activo en DB con caché de 30 s, limitadores de refresh/forgot/reset, hash de tokens de recuperación con poda, `TRUST_PROXY=false` por defecto y secreto JWT mínimo de 32 caracteres en producción. El bloqueo de PDFs pasa a inspeccionar la URL cruda porque `URL()` colapsa `%2e%2e`; los PDF se movieron a `var/invoices/`.

**Consecuencias:** Las respuestas de entrada malformada son 400/413 y los 500 no filtran mensajes internos ni stack; todas las respuestas incluyen `meta.requestId`. Los reintentos fallidos liberan la clave de idempotencia en vez de dejar un registro `FAILED` permanente. El seeder queda deshabilitado en producción y no sobrescribe contraseñas. Cobertura final: 41 unitarias + 6 smoke + 75 integración, `npm audit --audit-level=high` en 0 vulnerabilidades.

---

## ADR-010 — 2026-11-23: Validación final con MongoDB real y operación local

**Estado:** Aceptada

**Contexto:** Hasta ADR-009 las pruebas corrían con MongoDB en memoria y GitHub Actions, pero no se había ejecutado el backend contra un MongoDB real instalado ni validado el arranque en modo producción y la rutina de respaldo. El MSI de MongoDB 9.0.8 terminó primero con Error 1925 por falta de privilegios; una reinstalación posterior dejó `mongos.exe` pero no `mongod.exe`, y el servicio quedó en modo standalone (`setName: undefined`), incompatible con las transacciones multi-documento de ventas.

**Decisión:** Respaldar `mongod.cfg`, activar `replication.replSetName: rs0`, reiniciar el servicio MongoDB e inicializar `rs0` con `rs.initiate(...)`. Crear `projects/backend/.env` —ignorado por Git— con secretos aleatorios de 64 caracteres y contraseña admin aleatoria. Ampliar `scripts/integration-test.js` con `USE_EXTERNAL_MONGO=1` y añadir `npm run test:integration:real`: la suite fuerza la DB temporal `pymeplus_ia_integration`, la limpia al inicio y al final, y nunca toca `pymeplus_ia`. `npm run test:integration` conserva su comportamiento original con MongoDB en memoria.

**Consecuencias:** El replica set quedó con `isWritablePrimary: true`, `myState: 1` y `hosts: ['127.0.0.1:27017']`. Pasaron 41 pruebas unitarias, 6 smoke, 75 integración en memoria y 75 integración contra MongoDB real; la DB temporal se eliminó al terminar. PM2 inició con `NODE_ENV=production` en un puerto aparte: health `database: connected`, login real y consulta autorizada correctos; el proceso se eliminó después. `mongodump`/`mongorestore` restauraron 7 documentos con 0 fallos en una DB temporal que luego se eliminó. GitHub Actions confirmó `conclusion: success` para el commit anterior. Cobertura final del backend: 20/20.

---

## ADR-011 — 2026-11-24: Primera fase del frontend POS en Angular 22

**Estado:** Aceptada

**Contexto:** El backend estaba validado (20/20, GitHub Actions en verde) pero el usuario aún no tenía una interfaz para vender. La primera fase debía cubrir login, catálogo con escáner, carrito, cobro en USD/VES, idempotencia, factura PDF y eventos Socket.IO, sin tocar la lógica del backend ni ensuciar la base de producción. Angular CLI 22.2.6 generó el proyecto con Vitest/jsdom.

**Decisión:** Crear `projects/frontend/` con componentes standalone, Signals e inyección con `inject()`. Centralizar el sobre `{ success, message, data, meta, errors }` en `ApiService`; `apiInterceptor` añade JWT, `X-Request-Id` y `Accept-Version`, renueva el access token con el refresh rotado y redirige al login si falla. El POS usa un `CartStore` por ruta, calcula el total estimado con las reglas de IVA de `business_rules.md` y envía un UUID en `X-Idempotency-Key` que reutiliza en reintentos. El cobro en VES se bloquea con tasa de más de 48 h y todas las ventas con más de 72 h. Bootstrap 5.3 + Bootstrap Icons se incluyen como CSS compilado, con tema claro/oscuro. `npm run build:backend` compila y copia el resultado a `projects/backend/public/` de forma atómica y reproducible. Se añadió `frontend-tests.yml` con `npm ci`, pruebas, build y auditoría.

**Consecuencias:** 11/11 pruebas frontend OK y build de producción correcto (aprox. 685 kB sin comprimir, 132 kB de transferencia; budgets ajustados a 1 MB/2 MB). La verificación real contra el backend en `:3502` usó la DB temporal `pymeplus_ia_frontend_e2e` y confirmó login, catálogo, venta `VTA-2026-000001`, factura `FAC-2026-000001`, total `2.44 USD`, reintento idempotente, los eventos `invoice:ready`/`sale:created`/`stock:updated`, PDF válido y SPA servida por el backend. La DB temporal y el script efímero se eliminaron. Quedan para fases posteriores el módulo móvil Kotlin y los conectores MCP.

---

## ADR-012 — 2026-11-24: Segunda fase del frontend — inventario, ventas y reportes

**Estado:** Aceptada

**Contexto:** El POS ya estaba terminado y verificado. El usuario pidió las rutas `/inventario`, `/ventas` y `/reportes`, un layout con navegación responsiva y widget BCV, foco automático en el buscador, modal de cobro, tabla de stock mínimo y KPIs con gráficos, sin dañar el código existente. El bot de Telegram aparece en el contexto del producto, pero sigue pendiente y pertenece al hito MCP, no a Angular.

**Decisión:** Ampliar `app.routes.ts` con las tres rutas en español bajo el `ShellComponent` ya existente. Mantener el POS en `features/pos/` y crear los módulos nuevos en `features/inventario/`, `features/ventas/` y `features/reportes/`. El layout incorpora un toggle hamburger y `RateWidgetComponent`, que consulta `/api/exchange-rates/current` cada 5 minutos con `signal` y `takeUntilDestroyed`. El modal de cobro se implementa con `@if` y CSS propio porque `angular.json` no carga el JS de Bootstrap. Los gráficos son barras CSS calculadas con `computed`, sin añadir dependencias. `reportGuard` restringe reportes a `ADMIN`/`SUPERVISOR`/`FINANCE` y redirige al POS con un aviso legible. El resaltado de stock usa `available <= minimum` y se mantiene vivo con `stock:updated`/`stock_updated`.

**Consecuencias:** Backend, contratos y secretos quedaron intactos. El frontend pasó de 11 a 21 pruebas unitarias; build de producción en 713.32 kB sin comprimir y 137.43 kB de transferencia, dentro de budgets; `npm audit --audit-level=high` en 0 vulnerabilidades. La paleta Teal `#0F766E` y Bootstrap 5.3 se conservan. Pendientes: módulo móvil Kotlin, conectores MCP/Telegram y despliegue de esta fase.

---

## ADR-013 — 2026-11-24: Tasa de referencia de mercado cada 30 min y precios VES en vivo

**Estado:** Aceptada (con excepción explícita de BR-25 autorizada por el usuario)

**Contexto:** `/api/exchange-rates/current` devolvía `36` como tasa BCV oficial: venía de `FALLBACK_BCV_RATE` y `seed.js` lo persistía con `isFallback: false`. No existía ningún conector real: `bcv.org.ve` no es accesible desde el entorno y las APIs públicas sin clave son de mercado. El usuario eligió «API pública de mercado», aceptó «Sí, reemplazarla» para la facturación y pidió que los precios VES cambien cuando suba o baje la tasa, sin F5. También pidió quitar del login el texto de credenciales y mejorar su presentación visual.

**Decisión:** Añadir `services/market-rate.provider.js` (consulta `https://open.er-api.com/v6/latest/USD`, `rates.VES`, timeout, 2 intentos, validación de valor y antigüedad) y `services/market-rate.job.js` (ejecución inicial + `setInterval` de 30 min, arranque tras conectar MongoDB y parada en `WebServer.close()`). La tasa se persiste en el documento `{ date: hoy Caracas, source: 'BCV' }` con `status: 'ACTIVE'`, `isFallback: true`, `reason: 'Referencia de mercado (exchangerate-api)'` y `sourceUpdatedAt`: así `getActiveRate()` la usa sin cambiar enum, esquema ni contrato, y el PDF hereda la leyenda de respaldo. Una tasa con `verifiedBy` confirmada por Finanzas nunca se sobrescribe. Si falla el proveedor se conserva el último valor y se registra en logs. `SocketService` expone `rateUpdates` y su `connect()` es idempotente; `ShellComponent` conecta la sesión autenticada; el widget pasa de 5 a 30 min, muestra «Respaldo / Referencia de mercado» y el POS recarga `/products` y actualiza el `CartStore` al recibir `exchangeRate:updated`. El seeder ya no afirma que su valor es oficial. Login: tarjeta centrada y enriquecida, sin secretos en pantalla.

**Consecuencias:** Las ventas en VES pasan de calcular con `36` a la cotización de mercado (~919,82 al 2026-11-24); esto incumple BR-25 (solo BCV válido), riesgo fiscal aceptado explícitamente por el usuario. Las facturas no afirman tasa BCV: viajan con `isFallback: true` y motivo de procedencia. Se dejó intacto Clientes, PDF, JWT y los cuatro métodos de pago. Backend 49/49 pruebas; frontend 25/25; build 723.95 kB / 139.57 kB de transferencia; auditorías en 0 vulnerabilidades. Los servicios se dejaron apagados a petición del usuario (3500 y 4200 libres).

---

## ADR-014 — 2026-11-24: Roles demo, panel ADMIN de usuarios y cliente obligatorio en cada venta

**Estado:** Aceptada

**Contexto:** El POS registraba `customerName: 'Consumidor final'` de forma fija, el documento era opcional y solo las ventas a crédito exigían cliente; la factura mostraba «Documento: N/A». Además, el seeder solo creaba `ADMIN`, no existía `/api/users` y la SPA no ofrecía gestión de cuentas. El usuario pidió un esquema tipo WenSoft: nombre + cédula/RIF obligatorios para comprar, registro del cliente y presencia en la factura; usuarios demo para `CASHIER`, `SUPERVISOR`, `WAREHOUSE` y `FINANCE` con passwords en `.env`, y un módulo «Usuarios» solo para `ADMIN`.

**Decisión:** Crear `api/users/users.routes.js` con `GET/POST/PATCH/DELETE` protegidos por `requireAuth + requireRole('ADMIN')`, serialización mediante `toSafeObject()` (nunca se devuelve el hash), altas con `bcryptjs` vía hook del modelo, baja lógica, guardas contra auto-bloqueo y contra dejar el sistema sin administrador activo, e invalidación de la caché de revalidación al cambiar rol/estado. El seeder crea un usuario por rol con passwords leídas de `SEED_<ROL>_PASSWORD` en `.env` (nunca impresas) y no sobrescribe cuentas existentes. En Angular se añaden `UsersService`, `adminGuard`, la ruta `/usuarios` y un enlace condicional en el shell; el botón «Clientes» queda deshabilitado como estaba. En el backend, `resolveSaleCustomer()` exige `customerId` o `customerName` + documento `RIF`/`CI`/`PASSPORT`, reutiliza el cliente por número de documento o lo da de alta, y persiste `customerId` + `customerSnapshot`. El POS busca por `GET /customers?documentNumber=`, crea con `POST /customers` si hace falta y envía el `customerId` en `POST /sales`; «Cobrar» permanece deshabilitado hasta validar nombre y documento. El PDF imprime `Documento: <número> (<tipo>)` y elimina «Consumidor final».

**Consecuencias:** Toda venta queda atribuida a una persona o empresa identificada; no se permite facturación anónima. JWT, los cuatro métodos de pago del contrato y el menú Clientes no se modificaron. Backend 49/49 unitarias, 6/6 smoke y 86/86 integración; frontend 31/31 y build de producción correcto. El seeder requiere las cuatro variables de password en `.env`; si faltan, falla con un mensaje que nombra la variable, sin revelar valores. Servicios dejados apagados (3500 y 4200 libres).
