# Contratos de API — PymePlus IA

> **Versión:** 1.0 · **Estado:** Aprobado · **Fecha:** 2026-11-23
> Base path: `/api` · Versión por header `Accept-Version: 1` (sin cambiar la URL)
> Todas las respuestas usan el sobre (envelope) definido en §1. Los tipos `Money` y `RateSnapshot` de §2 son obligatorios en todo campo monetario.

---

## 1. Sobre de respuesta estandarizado

### 1.1 Éxito

```json
{
  "success": true,
  "message": "Productos obtenidos correctamente.",
  "data": [],
  "meta": {
    "requestId": "req_01JQZ8K3P7N2",
    "timestamp": "2026-11-23T14:32:10-04:00",
    "timezone": "America/Caracas",
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 137,
      "totalPages": 7,
      "hasNext": true
    },
    "currency": {
      "display": "USD",
      "base": "USD",
      "rate": {
        "value": 36.0,
        "source": "BCV",
        "date": "2026-11-23",
        "capturedAt": "2026-11-23T09:03:11-04:00",
        "status": "ACTIVE",
        "isFallback": false
      }
    }
  },
  "errors": []
}
```

### 1.2 Error

```json
{
  "success": false,
  "message": "No se pudo registrar la venta.",
  "userMessage": "No hay suficiente stock de Aceite vegetal 1 L. Quedan 3 unidades.",
  "data": null,
  "meta": {
    "requestId": "req_01JQZ8K3P7N3",
    "timestamp": "2026-11-23T14:33:02-04:00",
    "timezone": "America/Caracas"
  },
  "errors": [
    {
      "code": "INSUFFICIENT_STOCK",
      "field": "items[0].quantity",
      "detail": "Solicitadas 5 unidades; disponibles 3.",
      "suggestion": "Ajusta la cantidad o revisa el inventario disponible.",
      "retryable": false
    }
  ]
}
```

> **Regla de UX de errores:** `userMessage` es obligatorio y debe ser legible para un cajero sin conocimiento técnico; `errors[].suggestion` es la acción correctiva. Esto materializa la skill `Error_Handling_Human_UX_Skill.md`, ya implementada en el manejador global de `bin/server.js`.

### 1.3 Reglas del sobre
- `data` es `null` en errores; `errors` es `[]` en éxito.
- `meta.requestId` lo genera el servidor si el cliente no envía `X-Request-Id`.
- Todo timestamp usa ISO 8601 con offset `-04:00`.
- Paginación por defecto `page=1`, `limit=20`, máximo `limit=100`.
- Campos monetarios **nunca** son strings: son objetos `Money`.

---

## 2. Tipos comunes

### 2.1 `Money`
```json
{
  "amount": 234.0,
  "currency": "VES",
  "rateUsed": {
    "value": 36.0,
    "source": "BCV",
    "date": "2026-11-23",
    "capturedAt": "2026-11-23T09:03:11-04:00",
    "isFallback": false
  }
}
```
- `currency`: `"USD" | "VES"`.
- `rateUsed`: `null` cuando `currency === "USD"` (USD es la base). Obligatorio cuando `currency === "VES"`.
- Montos con máximo 2 decimales; tasas con máximo 4 decimales.
- `rateUsed.isFallback = true` obliga a mostrar la leyenda *"Tasa de respaldo — pendiente de confirmación BCV"*.

### 2.2 `RateSnapshot`
Copia inmutable de la tasa vigente al momento de la operación. Debe persistirse en ventas, ajustes y reportes históricos.

### 2.3 Headers

| Header | Requerido | Descripción |
|---|---|---|
| `Authorization` | Sí (excepto `/api/auth`) | `Bearer <accessToken>` |
| `Content-Type` | Sí en POST/PATCH | `application/json` |
| `Accept-Version` | No | `1` por defecto |
| `X-Request-Id` | No | Correlation ID del cliente |
| `X-Idempotency-Key` | **Sí** en `POST /api/sales` | UUID v4; evita doble cobro por reintento |
| `X-Display-Currency` | No | `USD` (default) o `VES`; afecta solo la presentación |

### 2.4 Catálogo de errores

| Código | HTTP | Significado |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Payload inválido |
| `INVALID_BARCODE` | 400 | Formato de código no soportado |
| `INSUFFICIENT_STOCK` | 409 | Existencia menor a la solicitada |
| `EXPIRED_BATCH` | 409 | Lote vencido y bloqueado para venta |
| `STALE_EXCHANGE_RATE` | 409 | Tasa BCV fuera de tolerancia temporal |
| `IDEMPOTENCY_CONFLICT` | 409 | Misma clave con payload distinto |
| `UNAUTHORIZED` | 401 | Token ausente o inválido |
| `FORBIDDEN` | 403 | Rol sin permiso para la acción |
| `NOT_FOUND` | 404 | Recurso inexistente |
| `RATE_LIMITED` | 429 | Demasiadas peticiones |
| `TRANSACTION_CONFLICT` | 409 | Conflicto concurrente; operación reintentable |
| `INTERNAL_ERROR` | 500 | Error no controlado (registrado en logs) |

---

## 3. Recurso: Products — `/api/products`

### 3.1 Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/products` | Lista paginada y filtrable |
| GET | `/api/products/:id` | Detalle de producto |
| GET | `/api/products/barcode/:barcode` | Búsqueda exacta para POS/escáner |
| POST | `/api/products` | Crear producto (solo rol `ADMIN` / Administrador; la creación fija `priceUSD`) |
| PATCH | `/api/products/:id` | Actualizar producto (campos de `pricing` solo rol `ADMIN`; almacén puede editar datos no monetarios) |
| DELETE | `/api/products/:id` | Baja lógica (`active=false`) |
| GET | `/api/products/low-stock` | Productos bajo mínimo |
| GET | `/api/products/expiring?days=30` | Lotes próximos a vencer |
| POST | `/api/products/:id/stock-adjustments` | Ajuste manual con motivo (auditado) |

**Query params de listado:** `search`, `sku`, `barcode`, `categoryId`, `lowStockOnly`, `expiringDays`, `active`, `sort`, `page`, `limit`.

### 3.2 Representación de producto

```json
{
  "id": "prod_01JQZ7M8X2",
  "sku": "BOD-000123",
  "barcode": "7701234567890",
  "name": "Aceite vegetal 1 L",
  "description": "Aceite vegetal refinado, presentación 1 litro.",
  "category": { "id": "cat_01JQZ6", "name": "Abarrotes" },
  "pricing": {
    "baseCurrency": "USD",
    "priceIncludesTax": false,
    "tax": { "type": "IVA_GENERAL", "rate": 0.16 },
    "cost": { "amount": 4.2, "currency": "USD", "rateUsed": null },
    "price": {
      "USD": { "amount": 6.5, "currency": "USD", "rateUsed": null },
      "VES": {
        "amount": 234.0,
        "currency": "VES",
        "rateUsed": {
          "value": 36.0,
          "source": "BCV",
          "date": "2026-11-23",
          "capturedAt": "2026-11-23T09:03:11-04:00",
          "isFallback": false
        }
      }
    },
    "mode": "AUTO_BCV",
    "overriddenAt": null
  },
  "stock": {
    "available": 12,
    "reserved": 0,
    "minimum": 5,
    "unit": "UN",
    "status": "NORMAL"
  },
  "batches": [
    {
      "lot": "LOT-2026-09-14",
      "quantity": 12,
      "manufacturingDate": "2026-09-14",
      "expirationDate": "2027-09-14"
    }
  ],
  "flags": { "active": true, "trackExpiration": true, "blockExpiredSale": true },
  "audit": {
    "createdBy": "usr_01JQZ5",
    "createdAt": "2026-10-02T10:12:00-04:00",
    "updatedAt": "2026-11-23T11:40:00-04:00"
  }
}
```

> `stock.status`: `OUT_OF_STOCK` | `LOW` | `NORMAL` | `OVERSTOCK`.

> **Autorización de precios:** los campos `priceUSD`, `costUSD`, `manualPriceVES`, `promotionPriceUSD`, `pricingMode`, `priceIncludesTax`, `taxType` y `pricing` solo pueden modificarse con el rol `ADMIN` (alias entrante: `Administrador`). Otros roles pueden actualizar nombre, descripción, categoría, stock, lotes y código de barras.

### 3.3 Ejemplo: `POST /api/products`

```json
{
  "sku": "BOD-000123",
  "barcode": "7701234567890",
  "name": "Aceite vegetal 1 L",
  "categoryId": "cat_01JQZ6",
  "costUSD": 4.2,
  "priceUSD": 6.5,
  "priceIncludesTax": false,
  "taxType": "IVA_GENERAL",
  "minimumStock": 5,
  "unit": "UN",
  "batches": [
    { "lot": "LOT-2026-09-14", "quantity": 12, "expirationDate": "2027-09-14" }
  ],
  "trackExpiration": true
}
```

**Respuesta:** `201 Created` con el producto representado arriba dentro de `data`.

---

## 4. Recurso: Sales — `/api/sales`

### 4.1 Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/sales` | Registrar venta (transaccional, requiere `X-Idempotency-Key`; roles `ADMIN`, `SUPERVISOR`, `CASHIER`) |
| GET | `/api/sales` | Listado con filtros `from`, `to`, `status`, `customerId`, `sellerId` |
| GET | `/api/sales/:id` | Detalle |
| POST | `/api/sales/:id/void` | Anular con reversión de stock (`ADMIN`/`SUPERVISOR` hasta `VOID_WINDOW_HOURS`; fuera de plazo solo `FINANCE`) |
| GET | `/api/sales/:id/invoice.pdf` | Descargar factura PDF con JWT |
| POST | `/api/sales/:id/resend-invoice` | Reenviar comprobante por correo |

**Alcance de lectura:** `ADMIN`/`SUPERVISOR`/`FINANCE` ven todas las ventas; `CASHIER` solo las de `audit.sellerId` (el filtro `sellerId` se ignora si intenta suplantar otro vendedor); `WAREHOUSE` recibe `403` en ventas, clientes, reportes y tasas. Los filtros inválidos (`status`, `from`, `to`, `page`, `limit`, `customerId`, `sellerId`) responden `400`, nunca `500`.

**Anulación:** es condicional sobre `status = COMPLETED` (una segunda anulación concurrente responde `409`), revierte el stock con lotes reales y vuelve a generar la factura como `VOID`. El pago a crédito registra `paid = 0`, `change = 0` y actualiza el saldo con `updateOne` condicional: dos ventas concurrentes no pierden actualizaciones ni superan el límite.

### 4.2 Ejemplo de petición

```json
{
  "customerId": "cus_01JQZ9A1",
  "currency": "USD",
  "items": [
    {
      "productId": "prod_01JQZ7M8X2",
      "barcode": "7701234567890",
      "quantity": 2,
      "discount": { "type": "PERCENT", "value": 10 }
    }
  ],
  "payment": { "method": "CASH_USD", "reference": null },
  "notes": "Venta en mostrador"
}
```

**Métodos de pago:** `CASH_USD`, `CASH_VES`, `CARD`, `TRANSFER`, `CREDIT`.

### 4.3 Representación de venta

```json
{
  "id": "sal_01JQZ8S4K9",
  "number": "VTA-2026-000123",
  "status": "COMPLETED",
  "customer": {
    "id": "cus_01JQZ9A1",
    "name": "Comercial La Esquina",
    "documentType": "RIF",
    "documentNumber": "J-12345678-9"
  },
  "items": [
    {
      "productId": "prod_01JQZ7M8X2",
      "sku": "BOD-000123",
      "name": "Aceite vegetal 1 L",
      "barcode": "7701234567890",
      "lot": "LOT-2026-09-14",
      "quantity": 2,
      "unit": "UN",
      "unitPrice": { "amount": 6.5, "currency": "USD", "rateUsed": null },
      "discount": {
        "type": "PERCENT",
        "value": 10,
        "amount": { "amount": 1.3, "currency": "USD", "rateUsed": null }
      },
      "tax": {
        "type": "IVA_GENERAL",
        "rate": 0.16,
        "amount": { "amount": 1.87, "currency": "USD", "rateUsed": null }
      },
      "subtotal": { "amount": 11.7, "currency": "USD", "rateUsed": null },
      "total": { "amount": 13.57, "currency": "USD", "rateUsed": null },
      "stockAfter": 10
    }
  ],
  "totals": {
    "subtotal": { "amount": 13.0, "currency": "USD", "rateUsed": null },
    "discount": { "amount": 1.3, "currency": "USD", "rateUsed": null },
    "taxableBase": { "amount": 11.7, "currency": "USD", "rateUsed": null },
    "iva": { "amount": 1.87, "currency": "USD", "rateUsed": null },
    "total": { "amount": 13.57, "currency": "USD", "rateUsed": null },
    "totalInVES": {
      "amount": 488.52,
      "currency": "VES",
      "rateUsed": {
        "value": 36.0,
        "source": "BCV",
        "date": "2026-11-23",
        "capturedAt": "2026-11-23T09:03:11-04:00",
        "isFallback": false
      }
    },
    "paid": { "amount": 20.0, "currency": "USD", "rateUsed": null },
    "change": { "amount": 6.43, "currency": "USD", "rateUsed": null }
  },
  "exchangeSnapshot": {
    "value": 36.0,
    "source": "BCV",
    "date": "2026-11-23",
    "capturedAt": "2026-11-23T09:03:11-04:00",
    "status": "ACTIVE",
    "isFallback": false
  },
  "payment": { "method": "CASH_USD", "reference": null },
  "invoice": {
    "number": "FAC-2026-000123",
    "controlNumber": "CTRL-2026-000123",
    "pdfUrl": "/api/sales/6501f2a4b9c1d4e8f00123ab/invoice.pdf",
    "issuedAt": "2026-11-23T14:34:05-04:00"
  },
  "audit": {
    "sellerId": "usr_01JQZ5",
    "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "createdAt": "2026-11-23T14:34:05-04:00",
    "voidedAt": null
  }
}
```

> Los importes siguen la fórmula de `business_rules.md` §3.3: base 11,70 × 16 % = 1,872 → **1,87**; total 13,57; en VES 13,57 × 36 = 488,52.

### 4.4 Respuestas especiales
- `201 Created` → venta registrada.
- `200 OK` con el mismo `id` → reintento idempotente, **no se descontó stock dos veces**.
- `409 STALE_EXCHANGE_RATE` → bloquea cobro en VES; se permite cobro en USD.

---

## 5. Recurso: Customers — `/api/customers`

### 5.1 Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/customers` | Listado paginado (`search`, `documentNumber`, `hasCredit`) |
| GET | `/api/customers/:id` | Detalle |
| POST | `/api/customers` | Crear cliente |
| PATCH | `/api/customers/:id` | Actualizar |
| GET | `/api/customers/:id/sales` | Historial de compras |
| GET | `/api/customers/:id/statement` | Estado de cuenta (saldo, movimientos) |

### 5.2 Representación

```json
{
  "id": "cus_01JQZ9A1",
  "name": "Comercial La Esquina",
  "documentType": "RIF",
  "documentNumber": "J-12345678-9",
  "email": "contacto@laesquina.ve",
  "phone": "+58 412 1234567",
  "address": {
    "street": "Calle Principal 24",
    "city": "Caracas",
    "state": "Miranda",
    "country": "VE"
  },
  "credit": {
    "enabled": true,
    "limit": { "amount": 500.0, "currency": "USD", "rateUsed": null },
    "balance": { "amount": 125.5, "currency": "USD", "rateUsed": null },
    "days": 30
  },
  "stats": {
    "totalPurchases": { "amount": 1840.75, "currency": "USD", "rateUsed": null },
    "salesCount": 42,
    "lastPurchaseAt": "2026-11-23T14:34:05-04:00"
  },
  "flags": { "active": true, "isTaxExempt": false },
  "audit": {
    "createdAt": "2025-08-11T09:00:00-04:00",
    "updatedAt": "2026-11-20T16:22:00-04:00"
  }
}
```

> `documentType`: `RIF` | `CI` | `PASSPORT`. `isTaxExempt=true` exige `exemptionCertificate` y aprobación de rol `FINANCE` (ver `business_rules.md`).

---

## 6. Recurso: Reports — `/api/reports`

### 6.1 Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/reports/sales` | Ventas por período, agrupables por día/semana/mes/producto/categoría |
| GET | `/api/reports/iva` | Base imponible, IVA generado y exento |
| GET | `/api/reports/inventory-valuation` | Valoración de inventario (USD/VES) |
| GET | `/api/reports/profitability` | Margen por producto/categoría |
| GET | `/api/reports/replenishment` | Proyección de reposición y días de cobertura |
| GET | `/api/reports/:key/export?format=pdf\|xlsx` | Exportación de cualquier reporte |

**Parámetros comunes:** `from`, `to` (ISO fecha), `currency=USD|VES`, `groupBy`, `valuationMode=historical|current`, `format`.

### 6.2 Representación de reporte

```json
{
  "reportKey": "sales",
  "period": {
    "from": "2026-11-01",
    "to": "2026-11-23",
    "timezone": "America/Caracas"
  },
  "displayCurrency": "USD",
  "valuationMode": "historical",
  "rateSnapshot": {
    "value": 36.0,
    "source": "BCV",
    "date": "2026-11-23",
    "capturedAt": "2026-11-23T09:03:11-04:00",
    "isFallback": false
  },
  "summary": {
    "salesCount": 318,
    "grossSales": { "amount": 8420.5, "currency": "USD", "rateUsed": null },
    "discounts": { "amount": 310.25, "currency": "USD", "rateUsed": null },
    "taxableBase": { "amount": 8110.25, "currency": "USD", "rateUsed": null },
    "iva": { "amount": 1297.64, "currency": "USD", "rateUsed": null },
    "netSales": { "amount": 8110.25, "currency": "USD", "rateUsed": null }
  },
  "series": [
    {
      "key": "2026-11-23",
      "label": "23 nov",
      "metrics": {
        "salesCount": 27,
        "total": { "amount": 712.4, "currency": "USD", "rateUsed": null }
      }
    }
  ],
  "alerts": [
    {
      "code": "LOW_STOCK_DETECTED",
      "message": "4 productos alcanzaron su stock mínimo en el período.",
      "severity": "warning"
    }
  ],
  "generatedAt": "2026-11-23T15:00:00-04:00"
}
```

### 6.3 Notas de reportes
- `valuationMode=historical` usa el `rateSnapshot` de cada transacción; `current` revalúa todo con la tasa vigente.
- `displayCurrency=VES` convierte cada métrica con la tasa correspondiente y expone `rateUsed` por valor.
- Un reporte **nunca muta** datos: es de solo lectura y auditable por `requestId`.

---

## 7. Eventos en tiempo real (Socket.IO)

| Evento | Dirección | Payload (resumen) |
|---|---|---|
| `sale:created` | Server → Client | `{ saleId, number, total: Money, sellerId, createdAt }` |
| `stock:updated` | Server → Client | `{ productId, sku, available, delta, reason, movementId }` |
| `stock:low` | Server → Client | `{ productId, sku, name, available, minimum, severity }` |
| `stock:expiring` | Server → Client | `{ productId, lot, expirationDate, daysRemaining }` |
| `exchangeRate:updated` | Server → Client | `{ value, source, date, status, isFallback }` |
| `invoice:ready` | Server → Client | `{ saleId, invoiceNumber }` (sala `user:<sellerId>`) |
| `invoice:voided` / `sale:voided` | Server → Client | `{ saleId, status, invoiceNumber? }` (sala `user:<sellerId>`) |

**Salas implementadas:** `authenticated`, `user:<userId>` y `role:<ROL>` (`ADMIN`, `SUPERVISOR`, `FINANCE`, `CASHIER`, `WAREHOUSE`). El socket acepta el JWT en `auth.token` o `Authorization: Bearer`; sin token se conecta como invitado, sin salas privadas. `sale:created`, `stock_updated`, `stock:updated`, `exchangeRate:updated`, `invoice:ready` e `invoice:voided` **nunca** se emiten con `io.emit` global: solo a salas autenticadas.

Los comprobantes se generan en `var/invoices/` (fuera del árbol servido) y **no** son archivos estáticos: `GET /uploads/documents/*` responde `404`, incluyendo las formas codificadas (`%69`, `%2f`, `%2e%2e`). La única descarga autorizada es `GET /api/sales/:id/invoice.pdf` con JWT.

**Errores de entrada:** JSON malformado, ObjectId inválido, error de validación de Mongoose y payload demasiado grande se traducen a `400`/`413` con el sobre estándar. Un `500` nunca expone mensajes internos ni stack traces; todas las respuestas incluyen `meta.requestId`.

---

## 8. Integración MCP (interna, no pública)

Las tools del asistente no exponen nuevos endpoints HTTP; invocan servicios de dominio bajo `/microservices`:

| Tool | Servicio subyacente | Escritura |
|---|---|---|
| `get_stock` | `GET /api/products/:id` o `/barcode/:barcode` | No |
| `get_low_stock` | `GET /api/products/low-stock` | No |
| `get_expiring_batches` | `GET /api/products/expiring` | No |
| `get_sales_summary` | `GET /api/reports/sales` | No |
| `send_expiration_alert` | Job de correo + `NotificationLog` | Sí (con aprobación) |

---

## 9. Reglas de compatibilidad y versionado
1. Nuevos campos pueden agregarse sin cambiar versión; campos existentes nunca se renombran ni se eliminan en v1.
2. Cambios de tipo o semántica requieren `Accept-Version: 2`.
3. Todo error, incluso el 500, respeta el sobre de §1.
4. Los clientes deben tratar `meta.currency.rate.isFallback=true` como advertencia visible al usuario.
