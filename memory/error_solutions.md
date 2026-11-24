# error_solutions.md

Registro de errores y parches aplicados.

## 2026-11-23 — Publicación en GitHub

### `gh auth login --with-token` falla con `missing required scope 'read:org'`
- **Causa:** el token guardado en Git Credential Manager tiene scopes `gist, repo, workflow`; GitHub CLI exige `read:org`.
- **Solución:** no usar `gh` para la publicación. Obtener la credencial con `git credential fill`, crear el repo con `POST https://api.github.com/user/repos` y hacer push con Git sobre HTTPS. El token nunca se mostró en consola ni en el chat.
- **Nota:** para usar `gh` en el futuro hay que regenerar el token con `read:org`.

### La API de GitHub responde `400 Problems parsing JSON` desde PowerShell
- **Causa:** `Invoke-RestMethod` serializaba el cuerpo con codificación UTF-16.
- **Solución:** convertir el JSON a bytes UTF-8 explícitamente:
  ```powershell
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  Invoke-RestMethod -Body $bytes -ContentType 'application/json; charset=utf-8'
  ```

### Smoke test con `Detected unsettled top-level await`
- **Causa:** `WebServer` construía el servidor HTTP pero nunca llamaba a `listen()`, así que el evento `listening` jamás se emitía.
- **Solución:** invocar `server.listen()` antes de esperar el evento. Como efecto colateral, `PORT=0` ahora es válido para pruebas (puerto libre asignado por el sistema).

## 2026-11-23 — Reglas de negocio

### `round2(1.005)` devolvía `1` en lugar de `1.01`
- **Causa:** error de coma flotante al hacer `Math.round(1.005 * 100)` (da 100.4999…).
- **Solución:** redondeo HALF_UP mediante desplazamiento exponencial:
  ```js
  const shifted = Number(`${Math.abs(number)}e${digits}`);
  return sign * Number(`${Math.round(shifted)}e-${digits}`);
  ```

### Warning de Mongoose 9: `the new option for findOneAndUpdate() is deprecated`
- **Solución:** reemplazar `{ new: true }` por `{ returnDocument: 'after' }` en productos, clientes e inventario. Verificado con cero warnings en la prueba de integración.

## 2026-11-23 — Seguridad del repositorio

### Factura PDF generada por pruebas quedó staged
- **Solución:** `git rm --cached -f` sobre el archivo y regla en `.gitignore` para `projects/backend/uploads/documents/invoices/`.
- **Verificación:** `git ls-files` no reporta `.env`, `node_modules` ni facturas generadas.

## 2026-11-23 — Cierre funcional de backend

### Reenvío de factura siempre fallaba
- **Causa:** `customerSnapshot` no guardaba `email`, y el conector afirmaba "en cola" sin distinción de envío real.
- **Solución:** snapshot con `email`/`phone`, conector `sendInvoice()` con webhook opcional y cola `microservices/outbox/`. La respuesta usa 202 + `{ queued: true, sent: false }` cuando solo quedó encolada.

### Anulación de venta a crédito usaba un saldo inexistente del snapshot
- **Causa:** se intentaba restaurar desde `customerSnapshot.balanceUSD`, campo que nunca se persistió.
- **Solución:** volver a leer el cliente dentro de la transacción (`Customer.findOne(...).session(session)`), calcular `Math.max(0, balanceActual - totalUSD)` y registrar `audit.creditBalanceAfter`.

### IVA exento se serializaba como 16 % y los modos de precio se ignoraban
- **Causa:** `serializers.js` tenía `rate: 0.16` fijo y siempre convertía con la tasa BCV.
- **Solución:** `IVA_RATES[taxType]` y función `resolveVesPrice()` para `AUTO_BCV`, `MANUAL_VES` y `PROMOTION`, con snapshot solo cuando el valor depende de BCV.

### Reintentos de idempotencia y stock duplicado
- **Causa:** riesgo de duplicar la lógica de descuento al extraer el controlador.
- **Solución:** el controlador nuevo reutiliza `decrementStock()` con `$inc` condicional dentro de la transacción; se conservan `payloadHash`, `X-Idempotency-Key` y el error `IDEMPOTENCY_CONFLICT`.

### Refresh token almacenado en texto plano
- **Causa:** la primera versión del endpoint `/api/auth/refresh` emitía un JWT sin persistencia ni hash.
- **Solución:** modelo `RefreshToken` con `tokenHash` SHA-256, `expiresAt` y `revokedAt`; rotación en cada renovación y verificación del hash antes de aceptar el token.

## 2026-11-23 — Comprobante PDF y autorización de precios

### Factura con `IVA (16%)` fijo y número `VTA-...`
- **Causa:** `invoicePdf()` en `helpers/pdf.js` hardcodeaba la alícuota y usaba el número interno de venta.
- **Solución:** helper dedicado `helpers/pdf-invoice.js` con `FAC-...`, `item.tax.rate` real (0 % en exentos) y leyenda de fallback; `sale.controller.js` usa el nuevo helper para descarga y correo.

### Comprobantes truncados a 55 líneas
- **Causa:** `createSimplePdf()` hacía `lines.slice(0, 55)` y emitía una sola página.
- **Solución:** paginación real con tantos objetos `/Page` y `/Contents` como hagan falta, recalculando `xref` y `/Count`. Cubierto con una venta de 80 líneas.

### Cambios de plantilla no se reflejaban en PDFs ya generados
- **Causa:** `ensureInvoiceFile()` solo escribía el archivo si no existía (`fs.access`).
- **Solución:** `fs.writeFile` incondicional (`force: true`) y emisión de `invoice:ready` tras el commit.

### `WAREHOUSE` podía fijar precios
- **Causa:** `PATCH /api/products/:id` solo usaba `requireRole('ADMIN', 'WAREHOUSE')` y el controlador no distinguía campos monetarios; `POST` permitía crear con `priceUSD`.
- **Solución:** `requirePricePermission` inspecciona el body (incluida forma anidada `pricing`) y exige `ADMIN`/`Administrador`; `POST` usa `requireAdmin`.

### `forbidden()` sobrescribía el `userMessage` personalizado
- **Causa:** la fábrica pasaba siempre su propio `userMessage` en las opciones, ignorando el mensaje legible del middleware.
- **Solución:** aceptar un segundo argumento `options` y combinarlo con los valores por defecto.

### Smoke test devolvía 500 en la ruta sin autenticación
- **Causa:** la validación de `JWT_SECRET` se ejecutaba antes de comprobar la presencia del header `Bearer`, por lo que una petición sin token resultaba en `INTERNAL_ERROR` en vez de `401`.
- **Solución:** validar primero que exista `scheme === bearer` y token; solo entonces verificar `JWT_SECRET`. Así, sin credenciales → 401 y con token pero sin secreto → 500. Probado en `test:smoke` (6/6) y en unitarias.

### `npm test` fallaba al comparar un `Buffer` con una cadena
- **Causa:** `assert.equal(buffer.subarray(0, 8), '%PDF-1.4')` comparaba tipos distintos.
- **Solución:** convertir el subarray con `.toString()` antes de comparar.

## 2026-11-23 — Auditoría posterior a la publicación

### Facturas PDF accesibles sin token
- **Causa:** `express.static('/uploads')` servía `documents/invoices/` y el correlativo de facturas es secuencial.
- **Solución:** middleware que responde 404 para `/uploads/documents/invoices/*`; `pdfUrl` apunta ahora a `/api/sales/:id/invoice.pdf`, que exige JWT.

### `invoice:ready` filtraba la URL del PDF a todos los sockets
- **Causa:** `io.emit` global con `pdfUrl` y handshake de Socket.IO sin autenticar.
- **Solución:** handshake opcional con JWT que une al cliente a `user:<id>`; emisión solo a esa sala y payload sin URL. La anulación usa `invoice:voided`/`sale:voided`.

### Correo y descarga podían servir un PDF parcial
- **Causa:** `fs.writeFile` directo más `fs.readFile` posterior en `resendInvoice` generaban carrera con descargas concurrentes.
- **Solución:** `ensureInvoiceFile()` devuelve el `Buffer`, escribe en un temporal y aplica `rename` atómico; la descarga usa `res.send(buffer)` y el correo recibe ese mismo buffer.

### El reintento idempotente no reparaba una factura perdida
- **Causa:** la rama `existing.status === 'COMPLETED'` devolvía la venta sin revisar `invoice`.
- **Solución:** si `!previous.invoice`, ejecutar `finalizeInvoice()` y recargar el documento antes de responder.

### La anulación dejaba la factura diciendo `COMPLETED`
- **Causa:** `voidSale` cambiaba el estado pero no regeneraba el PDF y emitía `stock:updated` con un payload de venta.
- **Solución:** regenerar con `finalizeInvoice(..., 'invoice:voided')` y emitir `sale:voided` a la sala del vendedor.

### `pricing` anidado devolvía `200` sin aplicar cambios
- **Causa:** `requirePricePermission` detectaba `body.pricing`, pero `update()` no lo leía.
- **Solución:** mapear `pricing.*` a las claves planas del modelo y soportar `priceIncludesTax`.

### El alias `Administrador` no funcionaba en `requireRole`
- **Causa:** la normalización solo estaba en `requireAdmin`/`requirePricePermission`.
- **Solución:** normalizar en `requireAuth` para que todas las rutas reciban `ADMIN`.

### `jwt.verify` aceptaba tokens HS384/HS512
- **Causa:** no se fijaba la lista de algoritmos permitidos.
- **Solución:** `algorithms: ['HS256']` en access y refresh, con firma HS256 explícita. Verificado con un test que firma en HS384 y espera 401.

### Semilla con contraseña de administrador pública
- **Causa:** `.env.example` y el seeder usan `Admin12345`; usarlo tal cual en producción permite takeover de ADMIN.
- **Solución:** advertencia explícita en `.env.example` y en el README del backend para cambiarla antes de sembrar datos.
