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
