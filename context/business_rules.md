# Reglas de Negocio — PymePlus IA

> **Versión:** 1.0 · **Estado:** Aprobado · **Fecha:** 2026-11-23
> Este documento es la **fuente de verdad** de los cálculos fiscales, la conversión multimoneda y la concurrencia de inventario.
> Implementación prevista: `/projects/backend/api/<modulo>/` con Mongoose + transacciones.

---

## 1. Principios generales

| # | Principio |
|---|---|
| BR-00 | **USD es la moneda base de costos y de reportes históricos.** VES es una vista derivada empleando la tasa BCV oficial. |
| BR-01 | **Nunca se mezclan monedas** dentro de una misma operación sin conversión previa y registro de la tasa utilizada. |
| BR-02 | **Toda operación monetaria guarda un `rateSnapshot` inmutable.** Los reportes históricos se reconstruyen con ese snapshot, nunca con la tasa actual. |
| BR-03 | **Toda salida de inventario es atómica, condicionada y auditada.** No existe descuento sin movimiento asociado. |
| BR-04 | **Ningún cálculo depende del estado del cliente**; se recalcula y persiste en el servidor. |
| BR-05 | **Redondeo una sola vez, al final de cada línea**, nunca sobre totales ya redondeados. |

---

## 2. Conversión automática a tasa BCV oficial

### 2.1 Fuente de verdad
- La **única fuente válida para documentos fiscales** es la tasa oficial publicada por el **Banco Central de Venezuela (BCV)**.
- Tasas paralelas o de referencia pueden mostrarse **solo como información**, etiquetadas explícitamente como *"referencia no fiscal"*, y jamás se usan para facturar ni para el IVA.
- Identificador del registro: `{ date: "YYYY-MM-DD", source: "BCV", value, capturedAt, status, isFallback, verifiedBy }`.
- Restricción de integridad: índice único sobre `{ date, source }` para impedir dos tasas BCV para el mismo día.

### 2.2 Captura y vigencia
1. **Frecuencia:** captura automática diaria a las **09:00 America/Caracas** (con reintento a las 15:00).
2. **Validez:** la tasa aplicable es la última con `status=ACTIVE` y `date` igual al día de la operación; si aún no existe, se usa la del día hábil anterior.
3. **Tolerancia de frescura (`RATE_MAX_AGE_HOURS = 48`):**
   - Dentro de 48 h → `ACTIVE`, uso normal.
   - Entre 48 y 72 h → `STALE`: se permite vender en **USD**; se bloquea el cobro en **VES** y se exige aprobación de `FINANCE`.
   - Más de 72 h → `EXPIRED`: se bloquean nuevas ventas y se escala alerta a administración.
4. **Fallback:** si falla la captura, se reutiliza el último valor válido con `isFallback=true`. El frontend y el PDF deben mostrar la leyenda *"Tasa de respaldo — pendiente de confirmación BCV"*.

### 2.3 Reglas de cálculo

```
monto_VES = redondear(monto_USD * tasa_BCV, 2)      // HALF_UP
monto_USD = redondear(monto_VES / tasa_BCV, 2)      // SOLO para desglose informativo, nunca se persiste como costo
```

- Tasa con hasta **4 decimales**; montos con **2 decimales**.
- **Regla de oro:** si un producto tiene precio base USD 6,50 y la tasa es 36,00, el precio VES es 234,00. Si cambia la tasa, se recalcula la **vista**, pero las ventas ya registradas conservan su `rateSnapshot`.
- **Desviación sospechosa:** si la nueva tasa difiere > 0,5 % de la anterior en menos de 24 h, se marca `PENDING_REVIEW` y requiere confirmación de `FINANCE` antes de activarse.

### 2.4 Override manual
- Solo roles `ADMIN` / `FINANCE`.
- Obligatorio: `reason`, `authorizedBy`, `previousValue`, `newValue`, `validFrom`.
- El override **no reemplaza** el registro BCV; convive como `{ source: "MANUAL" }` y siempre se reporta su procedencia.
- Toda creación/actualización de tasa emite `exchangeRate:updated` por Socket.IO.

### 2.5 Modos de precio del producto
| Modo | Comportamiento |
|---|---|
| `AUTO_BCV` (default) | `price.VES` se deriva de `price.USD` con la tasa vigente; no se edita manualmente |
| `MANUAL_VES` | El usuario fija `price.VES`; debe declarar `rateUsed` y motivo; se usa en promociones puntuales |
| `PROMOTION` | Precio temporal con `validFrom` / `validTo`; expirado vuelve automáticamente a `AUTO_BCV` |

---

## 3. Cálculo del Impuesto al Valor Agregado (IVA)

### 3.1 Tasas soportadas

| Código | Tasa | Uso |
|---|---|---|
| `IVA_GENERAL` | 16 % | Régimen general de bienes y servicios |
| `IVA_EXENTO` | 0 % | Bienes exentos; exige `exemptionReason` y certificado |
| `IVA_EXPORTACION` | 0 % | Exportaciones; exige destino y documentación de aduana |

> **Extensión futura (fuera de v1):** IGTF (Impuesto a las Grandes Transacciones Financieras). El modelo de `taxes[]` por línea ya permite agregarlo como un cargo adicional sin migrar el esquema de ventas.

### 3.2 Precedencia de la tasa
Se aplica la **primera** que exista:
1. `product.pricing.tax` (explícita en el producto)
2. `category.defaultTax`
3. Configuración global `IVA_GENERAL` (16 %)

### 3.3 Precio con impuesto incluido o excluido

**Precio sin IVA incluido (`priceIncludesTax=false`, caso estándar):**
```
baseImponible = redondear(precioUnitario * cantidad - descuentoLinea, 2)
iva           = redondear(baseImponible * tasa, 2)
totalLinea    = baseImponible + iva
```

**Precio con IVA incluido (`priceIncludesTax=true`):**
```
totalLinea    = redondear(precioUnitario * cantidad - descuentoLinea, 2)
baseImponible = redondear(totalLinea / (1 + tasa), 2)
iva           = totalLinea - baseImponible        // diferencia, NO re-multiply
```

**Ejemplo (16 %, precio USD 6,50 × 2, descuento 10 %):**
```
subtotal bruto = 13,00
descuento      = 1,30
base imponible = 11,70
IVA            = 1,87   (11,70 × 0,16 = 1,872 → 1,87)
total línea    = 13,57
total en VES   = 488,52 (13,57 × 36,00)
```
Este ejemplo coincide con el contrato de `api_contracts.md` §4.3.

### 3.4 Reglas críticas
1. El IVA se calcula **por línea**, nunca sobre la suma de líneas redondeadas.
2. El descuento se aplica **antes** del IVA, salvo que la configuración fiscal indique lo contrario.
3. Los totales de la venta son **suma de totales de línea**; el IVA total es **suma de IVA por línea**.
4. Si la venta se cobra en VES, los importes USD se calculan primero y luego se convierten con el `rateSnapshot` vigente. **Nunca** se calcula el IVA sobre un monto VES ya convertido y redondeado.
5. Una venta con `IVA_EXENTO` debe incluir `exemptionReason`; sin él, la validación rechaza la operación (`VALIDATION_ERROR`).
6. La factura PDF debe desglosar: base imponible, alícuota, monto de IVA, total y tasa BCV usada con su fecha.
7. Los comprobantes son **correlativos sin huecos**; una venta anulada conserva su número y genera una nota de crédito ligada.

---

## 4. Flujo de descuento atómico de inventario en Mongoose

### 4.1 Precondiciones técnicas
- MongoDB desplegado como **replica set** (las transacciones multi-documento no funcionan en `standalone`).
- `writeConcern: { w: "majority" }`, `readConcern: { level: "snapshot" }`, `readPreference: primary`.
- Índices: `{ sku: 1 }` único, `{ barcode: 1 }` único (cuando aplique), `{ "stock.available": 1 }`, `{ "batches.expirationDate": 1 }`.
- Clave de idempotencia con índice único en la colección `IdempotencyRecord`.

### 4.2 Secuencia obligatoria (transacción única)

| Paso | Acción | Regla de fallo |
|---|---|---|
| 1 | Validar payload y existencia de `X-Idempotency-Key` | Sin clave → `400 VALIDATION_ERROR` |
| 2 | Insertar/consultar `IdempotencyRecord` en estado `PENDING` con hash del payload | Misma clave con hash distinto → `409 IDEMPOTENCY_CONFLICT` |
| 3 | Si existe `COMPLETED`, devolver la venta original sin ejecutar nada | Respuesta `200`, **sin segundo descuento** |
| 4 | Iniciar sesión y transacción con `snapshot` / `majority` | Error de sesión → `503` reintentable |
| 5 | Para **cada ítem**, actualización condicional del producto: filtrar `_id` **y** `stock.available >= cantidad`, aplicar `$inc` negativo sobre `stock.available` (y `batches.$.quantity`) con opción `new: true` | Resultado `null` → `409 INSUFFICIENT_STOCK` → **abortar toda la transacción** |
| 6 | Verificar lote: si `flags.blockExpiredSale=true` y `expirationDate < hoy`, rechazar | `409 EXPIRED_BATCH` → abortar |
| 7 | Insertar `InventoryMovement` por cada línea: `{ productId, saleId, type: "SALE_OUT", delta, stockBefore, stockAfter, lot, userId, reason, createdAt }` | Fallo de insert → abortar |
| 8 | Insertar `Sale` con totales, impuestos, `exchangeSnapshot` y número correlativo | Fallo → abortar |
| 9 | Marcar `IdempotencyRecord` como `COMPLETED` con `saleId` | Fallo → abortar |
| 10 | **Commit** | `TransientTransactionError` → reintentar hasta 3 veces con backoff exponencial |
| 11 | **Después del commit** (outbox): emitir `sale:created`, `stock:updated`, `stock:low`; generar PDF; encolar notificaciones | Nunca dentro de la transacción: un fallo aquí **no** revierte la venta, solo se registra y se reintenta |

### 4.3 Por qué la actualización es condicional
La condición `stock.available >= cantidad` dentro del filtro de la propia operación de actualización garantiza que **dos cajeros que venden el último artículo simultáneamente no puedan ambos tener éxito**. MongoDB evalúa el filtro y el `$inc` de forma atómica a nivel de documento. No se permite el patrón "leer stock → verificar en memoria → escribir", porque introduce *lost updates*.

### 4.4 Reglas complementarias
- **Nunca** se permite stock negativo; la condición de filtro es la primera barrera, la validación de esquema (`min: 0`) la segunda.
- Si el descuento exitoso deja `available <= minimum`, se dispara `stock:low` y se notifica al bot de Telegram (con dedupe de 24 h por producto).
- El número correlativo de venta/factura se obtiene de un contador atómico (`$inc` en `Sequence`), también dentro de la transacción, para evitar duplicados por concurrencia.
- El `stockAfter` devuelto en la respuesta es el valor **real resultante** de la operación condicional, no un valor calculado por el cliente.

### 4.5 Anulación y reversión
1. Solo roles `ADMIN` / `SUPERVISOR`.
2. Dentro de `VOID_WINDOW_HOURS = 24` (configurable); fuera de ese plazo se requiere aprobación de `FINANCE`.
3. Motivo obligatorio; la venta original **nunca se elimina**: cambia a `status=VOID` y se crea una nota de crédito ligada.
4. Nueva transacción con `$inc` positivo sobre el mismo producto/lote y un `InventoryMovement` de tipo `SALE_VOID`.
5. Se emite `stock:updated` y se reevalúa la alerta de stock mínimo.

### 4.6 Ajustes manuales de inventario
- Requieren `reason` de una lista cerrada: `RECEIPT`, `COUNT_CORRECTION`, `DAMAGE`, `THEFT`, `RETURN`, `EXPIRED_DISPOSAL`.
- Registran `stockBefore` / `stockAfter` y usuario responsable.
- Los ajustes de salida usan la **misma actualización condicional** que las ventas.

---

## 5. Reglas de stock mínimo, vencimientos y reposición

### 5.1 Stock mínimo
- Umbral configurable por producto; si no existe, hereda el de la categoría y luego el global (`MIN_STOCK_GLOBAL = 0`).
- Estados derivados: `OUT_OF_STOCK` (`available = 0`), `LOW` (`available <= minimum`), `NORMAL`, `OVERSTOCK` (`available > maximum`, si se define).
- Cálculo sugerido de `maximum`: `consumoMedioDiario * (leadTimeDays + safetyDays)`.

### 5.2 Vencimientos
- Un lote con `expirationDate < hoy` se considera vencido; si `blockExpiredSale=true`, no se puede vender.
- Alertas por correo a **30, 7, 3 y 1 días** antes del vencimiento, con dedupe por lote y día.
- La baja de un lote vencido es un ajuste `EXPIRED_DISPOSAL`, nunca una eliminación física.

### 5.3 Proyección de reposición (v1 determinista)
```
consumoMedioDiario = unidadesVendidasUltimos30Dias / 30
puntoReorden       = consumoMedioDiario * leadTimeDays + stockSeguridad
cantidadSugerida   = max(0, puntoReorden - stock.available - stock.reserved + stock.minimum)
diasCobertura      = stock.available / consumoMedioDiario   // ∞ si consumo = 0
```
- `leadTimeDays` por producto o categoría (default 7).
- Prioridad de la sugerencia: `CRITICAL` si `diasCobertura < leadTimeDays`, `HIGH` si `< leadTimeDays * 1,5`, else `NORMAL`.
- Esta regla es reemplazable por un modelo ML en v1.1 sin cambiar el contrato de `/api/reports/replenishment`.

---

## 6. Reglas de clientes y crédito

1. Identificadores válidos: `RIF`, `CI`, `PASSPORT`; se validan formato y dígito verificador cuando aplique.
2. Un RIF duplicado se rechaza con `409 VALIDATION_ERROR`; se permite búsqueda por coincidencia parcial para evitar altas duplicadas.
3. Una venta `CREDIT` requiere: cliente activo, `credit.enabled=true`, `balance + total <= limit` y `days` vigente. El saldo se actualiza en la **misma transacción** que el stock.
4. Los clientes exentos de IVA requieren certificado vigente; vencido el certificado, se revierte automáticamente a `IVA_GENERAL`.
5. El estado de cuenta consolida ventas, abonos y notas de crédito, siempre en la moneda solicitada con su `rateUsed`.

---

## 7. Reglas de IA / MCP

1. Las tools de consulta son **solo lectura**; no pueden descontar stock ni crear ventas en v1.
2. El bot responde con la **misma moneda preferida** del usuario y cita siempre la fecha de la tasa BCV.
3. Si la tasa está `STALE` o `isFallback=true`, la respuesta del bot debe incluir la advertencia.
4. Ninguna respuesta de IA puede incluir `cost`, márgenes o datos de otro cliente según el rol del solicitante.
5. Toda interacción se registra con `chatId`, intención, tool invocada, resultado y latencia.
6. Las alertas de vencimiento se agrupan por destinatario y respetan dedupe; un fallo de envío se reintenta 3 veces antes de escalar.

---

## 8. Catálogo de errores de negocio (mapeo a API)

| Código | Condición | Mensaje al usuario |
|---|---|---|
| `INSUFFICIENT_STOCK` | `available < cantidad` | "No hay suficiente stock de {producto}. Quedan {n} unidades." |
| `EXPIRED_BATCH` | Lote vencido bloqueado | "El lote {lote} está vencido. Usa otro lote." |
| `STALE_EXCHANGE_RATE` | Tasa > 48 h | "La tasa BCV está desactualizada. Puedes cobrar en USD o esperar la actualización." |
| `EXCHANGE_RATE_EXPIRED` | Tasa > 72 h | "No se puede facturar hasta actualizar la tasa BCV." |
| `IDEMPOTENCY_CONFLICT` | Misma clave, distinto payload | "La operación ya existe con otros datos. Genera una nueva venta." |
| `TAX_EXEMPTION_REQUIRED` | Exento sin certificado | "Para aplicar exención de IVA se requiere el certificado y el motivo." |
| `CREDIT_LIMIT_EXCEEDED` | Saldo + total > límite | "El cliente superó su límite de crédito disponible." |
| `VOID_WINDOW_CLOSED` | Anulación fuera de plazo | "El plazo para anular sin aprobación terminó." |
| `TRANSACTION_CONFLICT` | Conflicto concurrente | "Otro cajero modificó el stock. Revisa la existencia e inténtalo de nuevo." |

---

## 9. Trazabilidad
- Origen de los requisitos → `context/system_context.md`
- Formato de respuestas y campos → `context/api_contracts.md`
- Patrones de implementación → `skills/Backend_Architecture_CRUD.md`, `skills/Validations_Security.md`
- Decisiones y cambios → `memory/architecture_decisions.md`
