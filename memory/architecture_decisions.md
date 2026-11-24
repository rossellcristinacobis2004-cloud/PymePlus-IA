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
