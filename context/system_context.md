# Contexto del Sistema — PymePlus IA

> **Documento maestro de producto.** Toda decisión de arquitectura, UX o regla de negocio debe ser trazable a este archivo.
> **Versión:** 1.0 · **Estado:** Aprobado · **Fecha:** 2026-11-23
> **Jerarquía:** `AGENTS.md` → `system_context.md` → `business_rules.md` / `api_contracts.md`

---

## 1. Identidad del proyecto

| Campo | Valor |
|---|---|
| **Nombre oficial** | **PymePlus IA** |
| Tagline propuesto | *"Tu negocio, bajo control. En USD y VES, al instante."* |
| Naturaleza | Plataforma web + móvil de gestión comercial (POS, inventario, finanzas) con asistencia de IA vía MCP |
| Dominio | Comercio minorista y pequeñas empresas de servicios en Venezuela |
| Idioma principal | Español neutro venezolano (`es-VE`) |
| Zona horaria | `America/Caracas` (UTC-04:00, sin horario de verano) |
| Monedas | **USD** (base de costos y reportes) · **VES** (bolívar soberano, emisión fiscal) |
| Tipo de despliegue | SPA Angular servida por Express + app Android Kotlin + conectores MCP |

### 1.1 Misión
Reducir la incertidumbre operativa del pequeño comercio venezolano entregando una herramienta que permita **vender rápido, saber exactamente qué hay en stock, facturar correctamente y entender el negocio en dos monedas**, sin exigir conocimiento contable previo.

### 1.2 Objetivos estratégicos
1. Convertir el inventario de un activo opaco en un activo **auditado y trazable**.
2. Eliminar la fricción de la doble moneda mediante **conversión BCV automática con snapshot** de la tasa.
3. Llevar el tiempo de atención en caja por debajo de 90 segundos.
4. Anticipar quiebres de stock con alertas y proyecciones accionables.
5. Ofrecer un asistente conversacional que responda preguntas operativas sin abrir la aplicación.

---

## 2. Público objetivo

### 2.1 Segmentos primarios

| Segmento | Contexto operativo | Necesidad crítica | Barrera de adopción |
|---|---|---|---|
| **Bodegones** | Alta rotación, cientos de SKU, ventas en efectivo, mermas frecuentes | Control de stock por lote y vencimiento | Poco tiempo para capacitación; requiere interfaz de caja simple |
| **Ferreterías** | Catálogo extenso, medidas/variantes, ventas por mostrador y a obra | Búsqueda rápida por código y equivalencias, crédito a clientes | Precios cambian a diario por tipo de cambio |
| **Comercios al detal** | Clientes frecuentes, tickets pequeños, alta concurrencia en caja | POS ultrarrápido y facturación inmediata | Dependencia de internet |
| **Pequeñas empresas de servicios** | Ventas recurrentes, menos inventario, más clientes y cobros | Reportes, cartera y comprobantes | Perciben las herramientas contables como complejas |

### 2.2 Personas (roles de usuario)

| Rol | Responsabilidad | Interés principal en PymePlus IA |
|---|---|---|
| **Cajero(a)** | Registrar ventas, cobrar, imprimir comprobante | Velocidad, teclado/escáner, pocos clics |
| **Administrador / Dueño** | Precios, compras, supervisión | Márgenes, stock, reportes, alertas |
| **Contador / Financiero** | Cierre, IVA, tasa BCV, auditoría | Trazabilidad, snapshot de tasa, exportación |
| **Encargado de almacén** | Recepciones, ajustes, vencimientos | Conteo, lotes, alertas de caducidad |
| **Usuario de IA (Telegram)** | Consultas remotas | Stock en tiempo real sin abrir la app |

> **Nota de localización:** la skill `Validations_Security.md` menciona RUT chileno; en PymePlus IA se adapta a **RIF, Cédula de Identidad y Pasaporte** como identificadores fiscales del cliente.

---

## 3. Problema comercial

| # | Problema | Causa raíz | Impacto esperado | KPI afectado |
|---|---|---|---|---|
| 1 | **Pérdida de inventario por falta de auditoría** | Salidas sin registrar, mermas no documentadas, ajustes sin responsable | 2–5 % del valor de inventario al mes | Exactitud de inventario · % de merma |
| 2 | **Descontrol de tasa BCV / USD** | Precios actualizados a "ojo", mezcla de tasas oficiales y paralelas, reprocesos manuales | Márgenes negativos y facturas inconsistentes | % de ventas con precio desactualizado · Tiempo de repricing |
| 3 | **Lentitud en atención al cliente** | Búsqueda manual en libreta/Excel, cálculo mental de IVA y vuelto | Colas, abandono de compra, errores de cobro | Tiempo medio por venta · Ticket promedio |
| 4 | **Falta de proyecciones de reposición** | No se cruza histórico de ventas con stock mínimo y lead time | Quiebres de stock y sobrestock inmovilizado | Días de inventario · % de quiebres |

### 3.1 Consecuencia transversal
Sin datos confiables, el comercio no puede responder tres preguntas básicas: *¿cuánto tengo?, ¿cuánto gané realmente? y ¿qué debo comprar mañana?* PymePlus IA existe para convertir esas tres preguntas en respuestas automáticas y auditables.

---

## 4. Necesidades operativas

| ID | Requisito | Descripción | Criterio de aceptación | Prioridad |
|---|---|---|---|---|
| OP-01 | **POS ultrarrápido** | Carrito con búsqueda incremental, atajos de teclado, cálculo de vuelto y cobro en USD o VES | Búsqueda < 300 ms; confirmación de venta < 2 s; ≤ 3 interacciones para una venta simple | P0 |
| OP-02 | **Escáner de códigos de barras** | Pistola USB (modo HID/teclado) y cámara del dispositivo (BarcodeDetector / ZXing en Kotlin) | Soporte EAN-13, UPC-A y Code 128; lectura y respuesta < 500 ms | P0 |
| OP-03 | **Facturas / comprobantes en PDF** | Generación server-side con datos fiscales, desglose de IVA y snapshot de tasa BCV | PDF disponible < 3 s; reimpresión ilimitada; número correlativo sin huecos | P0 |
| OP-04 | **Alerta de stock mínimo** | Umbral por producto/categoría, notificación in-app y vía bot de Telegram | Disparo inmediato tras el descuento; deduplicación 24 h por producto | P0 |
| OP-05 | **Reportes financieros** | Ventas, IVA, margen, valoración de inventario, cartera y proyección de reposición | Generación < 5 s para 12 meses; exportación PDF/XLSX; selector USD/VES | P1 |
| OP-06 | **Multimoneda** | Visualización y cobro en USD o VES con tasa BCV vigente | Toda transacción almacena `rateSnapshot`; nunca se mezclan monedas sin conversión | P0 |
| OP-07 | **Trazabilidad** | Registro de cada movimiento de inventario con usuario, motivo y antes/después | 100 % de movimientos auditables; sin eliminación física de registros | P0 |

### 4.1 Requisitos no funcionales
- **Rendimiento:** p95 de endpoints de POS < 500 ms; p95 de reportes < 5 s.
- **Disponibilidad:** objetivo 99,5 % mensual; degradación elegante si falla el proveedor de tasa BCV (usa último valor válido, marcado como `isFallback`).
- **Seguridad:** JWT + bcrypt, `helmet`, CORS restringido, validación estricta de entrada.
- **Accesibilidad:** WCAG 2.1 AA; navegación completa por teclado; estados nunca comunicados solo por color.
- **Respaldo:** backup previo a cada despliegue según protocolo §5 de `AGENTS.md`.

---

## 5. Identidad Visual

### 5.1 Tokens de color (fuente de verdad)

| Rol | Token | Hex | Uso principal |
|---|---|---|---|
| **Primary — Teal / Esmeralda Comercio** | `--brand-primary` | `#0F766E` | CTA de cobro, acciones principales, estado activo, acentos de marca |
| **Secondary — Azul Cobalto** | `--brand-secondary` | `#1E40AF` | Navegación, enlaces, cifras financieras, gráficos de comparación |
| **Warning / Alert — Ámbar / Terracota** | `--brand-warning` | `#D97706` | Stock mínimo, vencimientos, validaciones, estados pendientes |
| **Background claro** | `--brand-bg-light` | `#F8FAFC` | Fondo de aplicación en tema claro |
| **Background oscuro** | `--brand-bg-dark` | `#0F172A` | Fondo de aplicación en tema oscuro |

**Tokens derivados sugeridos** (no reemplazan a los anteriores): éxito `#16A34A`, peligro `#DC2626`, texto primario claro `#0F172A`, texto primario oscuro `#E2E8F0`, borde `#E2E8F0` / `#334155`.

### 5.2 Reglas de aplicación
1. **Contraste:** mínimo 4,5:1 para texto normal y 3:1 para elementos gráficos. En tema oscuro, aclarar el primary a `#2DD4BF` para mantener contraste sobre `#0F172A`.
2. **No depender solo del color:** stock bajo = ámbar **+ icono `exclamation-triangle` + texto "Stock bajo"**.
3. **Dinero en `tabular-nums`** para alineación de columnas; siempre con símbolo y código de moneda (`$ 6,50 USD` / `Bs. 234,00`).
4. **Bootstrap 5.3+** mediante variables CSS y `data-bs-theme="light|dark"`; sobrescritura centralizada en un único archivo de tokens.
5. **Iconografía:** Bootstrap Icons / Lucide, trazo consistente de 1,75 px.
6. **Feedback de escaneo:** vibración/sonido corto en móvil; destello sutil en el campo de código en web.
7. **Densidad:** interfaz compacta en POS (más filas por pantalla), más espaciosa en reportes.

### 5.3 Tipografía propuesta
- **Inter** (o stack del sistema: `system-ui, -apple-system, "Segoe UI", sans-serif`).
- Escala: 12 / 14 / 16 / 20 / 28 / 36 px; pesos 400 / 500 / 600 / 700.

---

## 6. Estrategia de Asistencia de IA (MCP)

### 6.1 Objetivo
Ofrecer un asistente conversacional que resuelva consultas operativas sin exigir acceso a la aplicación, y que anticipe incidentes de vencimiento mediante correo electrónico.

### 6.2 Arquitectura general
```
 Canales                    Capa MCP (/microservices)           Datos
┌──────────────┐       ┌──────────────────────────────┐    ┌────────────┐
│ Telegram Bot │──────▶│ MCP Server · Tool Registry   │───▶│ MongoDB    │
│ Email/SMTP   │◀──────│ → get_stock / get_low_stock  │    │ Socket.IO  │
│ (futuro Web) │       │ → get_expiring_batches       │    │ Job queue  │
└──────────────┘       │ → get_sales_summary          │    └────────────┘
                       │ → send_expiration_alert      │
                       └──────────────────────────────┘
```

### 6.3 Telegram — consultas de stock en tiempo real
- **Flujo:** mensaje del usuario → detección de intención → validación de identidad/rol → invocación de tool de **solo lectura** → respuesta formateada con moneda preferida y tasa BCV citada.
- **Ejemplos de intención:** *"¿cuánto aceite hay?"*, *"productos por debajo del mínimo"*, *"¿cuánto vendí hoy?"*.
- **Respuesta esperada:** nombre, existencias, mínimo, precio USD/VES, fecha de la tasa y advertencia si el dato está `STALE`.
- **Límite v1:** el bot **no registra ventas ni modifica stock**; solo informa. Acciones de escritura requieren aprobación humana explícita en la app.

### 6.4 Correo electrónico — alertas de vencimiento
- **Job programado:** diario 08:00 `America/Caracas`.
- **Consulta:** lotes con `expirationDate <= hoy + 30 días` y `stock.available > 0`.
- **Entrega:** un correo agrupado por destinatario con tabla de producto, lote, vencimiento, días restantes y valor en USD/VES.
- **Auditoría:** cada envío genera `NotificationLog` con destinatario, `batchIds`, resultado del proveedor y `sentAt`.
- **Dedupe:** un mismo lote no genera más de una alerta por día ni más de una alerta a 7/3/1 días antes del vencimiento.

### 6.5 Guardrails
| Riesgo | Control |
|---|---|
| Filtración de costos/márgenes | Tools filtran campos según rol; el bot nunca expone `cost` a Cajero |
| Alucinación de datos | El LLM solo puede responder con el payload devuelto por la tool; sin datos → "no encontré información" |
| Abuso del bot | Rate limit por `chatId`, whitelist de usuarios, logging de cada consulta |
| Acciones sensibles | Confirmación de doble paso y registro de auditoría antes de cualquier escritura |
| Caída del proveedor de IA | Respuesta determinista de fallback con datos crudos de la tool |

### 6.6 Observabilidad
Latencia por tool, tasa de acierto de intenciones, feedback 👍/👎, cantidad de alertas entregadas/rebotadas y logs centralizados en `/logs`.

---

## 7. Alcance

### 7.1 Incluido en v1
POS web, escáner, inventario con lotes, clientes, facturación PDF, multimoneda BCV, reportes, alertas, app Android Kotlin (MVVM) de consulta y venta, bots MCP de Telegram y correo.

### 7.2 Fuera de alcance v1
Contabilidad electrónica completa, integración bancaria/pasarelas de pago, multi-sucursal activa (el modelo la contempla, se habilita en v1.1), pronósticos con ML (v1 usa regla de reposición determinista descrita en `business_rules.md`), facturación electrónica ante el SENIAT.

---

## 8. Principios arquitectónicos (alineados con `AGENTS.md`)

1. Backend **Node.js 26 ESM + Express 5**, módulos bajo `/api/<modulo>/`.
2. **MongoDB + Mongoose** con transacciones (desplegado en replica set).
3. **JWT + bcrypt**, `helmet`, CORS controlado y validación estricta de entrada.
4. **Socket.IO** para eventos de stock y ventas en tiempo real.
5. Errores centralizados en **mensajes legibles con sugerencia** antes de llegar a Toast (Angular) o Snackbar (Kotlin).
6. Frontend **Angular 22 standalone + Signals + Control Flow**, Bootstrap 5.3.
7. Móvil **Kotlin nativo MVVM + Retrofit/Corrutinas**, APK versionado en `/uploads/apks/version.json`.
8. Build de producción copiado a `/projects/backend/public/`; despliegue con PM2 y respaldo previo obligatorio.
9. Ningún secreto en repositorio; `.env.example` como única plantilla.

---

## 9. Métricas de éxito

| KPI | Meta v1 |
|---|---|
| Tiempo medio por venta | < 90 s |
| Exactitud de inventario (conteo vs sistema) | ≥ 98 % |
| Merma mensual | ≤ 2 % del valor de inventario |
| Quiebres de stock | ≤ 3 % de SKU activos por mes |
| Ventas con precio desactualizado | 0 % |
| Disponibilidad de consulta de stock por bot | ≥ 99 % |

---

## 10. Glosario

| Término | Definición |
|---|---|
| **BCV** | Banco Central de Venezuela; fuente oficial de la tasa de cambio |
| **USD / VES** | Dólar estadounidense / bolívar soberano |
| **POS** | Punto de venta |
| **SKU** | Unidad de mantenimiento de inventario |
| **Lote** | Grupo de unidades con fecha de fabricación/vencimiento común |
| **IVA** | Impuesto al Valor Agregado |
| **MCP** | Model Context Protocol; protocolo para exponer herramientas a modelos de IA |
| **Idempotencia** | Garantía de que repetir una petición no duplica su efecto |
| **Snapshot de tasa** | Copia inmutable de la tasa usada en una transacción |
| **Replica set** | Conjunto de nodos MongoDB requerido para transacciones multi-documento |

---

## 11. Trazabilidad
- Reglas de cálculo y concurrencia → `context/business_rules.md`
- Contratos HTTP y eventos → `context/api_contracts.md`
- Patrones de implementación → `/skills/`
- Decisiones arquitectónicas → `memory/architecture_decisions.md`
