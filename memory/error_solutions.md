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
