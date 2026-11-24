# PymePlus IA — Frontend POS

[← Volver al README principal](../../README.md)

SPA del punto de venta: búsqueda de productos, carrito reactivo, cobro en USD/VES y descarga de factura.

**Stack:** Angular 22 standalone · Signals · Bootstrap 5.3 · Bootstrap Icons · Socket.IO 4 · Vitest/jsdom.

## Requisitos

- Node.js ≥ 26 y npm ≥ 11.
- Backend de PymePlus IA en `http://127.0.0.1:3500` con MongoDB `rs0` y datos sembrados.

## Instalación y desarrollo

```bash
cd projects/frontend
npm install
npm start
```

Abre `http://localhost:4200/`. El `proxy.conf.json` redirige `/api` y `/socket.io` al backend, así que no se necesita configurar CORS en desarrollo.

Inicia sesión con el administrador creado por `npm run seed` en el backend. La contraseña real está en `projects/backend/.env` (`SEED_ADMIN_PASSWORD`), ignorado por Git.

## Scripts

| Script | Descripción |
|---|---|
| `npm start` | Servidor de desarrollo en `:4200` con proxy al backend |
| `npm run build` | Build de producción en `dist/pymeplus-web/browser/` |
| `npm run build:backend` | Build y copia limpia a `projects/backend/public/` |
| `npm test -- --watch=false` | Pruebas unitarias con Vitest (modo CI) |
| `npm audit --audit-level=high` | Auditoría de dependencias |

## Flujo del POS

1. **Login**: envía credenciales a `POST /api/auth/login`, guarda access/refresh token y conecta el socket con JWT.
2. **Catálogo**: carga `GET /api/products?limit=100&active=true` y `GET /api/exchange-rates/current`. Busca por nombre, SKU o código de barras; Enter dispara `GET /api/products/barcode/:barcode`.
3. **Carrito**: señales con líneas agrupadas por producto/lote; permite cantidad y descuento por línea. El total estimado usa las mismas reglas de IVA del backend y es solo informativo: el servidor recalcula y persiste los importes.
4. **Cobro**: soporta USD y VES. El cobro en VES se bloquea si la tasa tiene más de 48 h; por encima de 72 h se bloquean todas las ventas. El monto pagado y el vuelto se calculan en la moneda elegida.
5. **Registro**: `POST /api/sales` envía una clave UUID en `X-Idempotency-Key`, reutilizada si el usuario reintenta. Ante error de stock, permisos o tasa, se muestra `userMessage` y `suggestion` del backend.
6. **Factura**: tras la venta se descarga `invoice.pdfUrl` con JWT. Los eventos `sale:created`, `stock:updated`, `stock:low` e `invoice:ready` actualizan la interfaz en vivo.

## Arquitectura

```text
src/app/
├── core/
│   ├── errors/            ApiError: mensajes legibles del sobre backend
│   ├── guards/            sesión y roles con acceso al POS
│   ├── handlers/          ErrorHandler global con toast
│   ├── interceptors/      JWT, refresh, X-Request-Id, Accept-Version
│   ├── models/            contratos tipados (Money, Product, Sale, Rate…)
│   └── services/          API, autenticación, tokens, sockets, toasts
├── features/
│   ├── auth/              login
│   └── pos/               POS, carrito con signals y store por ruta
└── shared/                layout, toasts, cálculo de carrito y dinero
```

Solo los roles `ADMIN`, `SUPERVISOR` y `CASHIER` entran al POS; `WAREHOUSE` es redirigido al login. El tema claro/oscuro se guarda en `localStorage`. La sesión se limpia al cerrar sesión o si el refresh falla.

## Pruebas y verificación real

Las 11 pruebas unitarias cubren cálculo de IVA con descuento, inclusión de IVA en el precio, conversión a VES, redondeo HALF_UP, formato monetario, carrito con lotes, desenvuelto del sobre API, errores legibles y header de petición.

La verificación end-to-end se ejecutó contra un backend real en puerto `3502` y la base temporal `pymeplus_ia_frontend_e2e`, eliminada al terminar. Resultado: login, catálogo, venta `VTA-2026-000001`, factura `FAC-2026-000001`, total `2.44 USD`, reintento idempotente, eventos `invoice:ready`/`sale:created`/`stock:updated`, PDF de 1924 bytes y SPA servida desde el backend. El script efímero no se versiona.

## Despliegue

```bash
npm run build:backend
cd ../backend
pm2 reload ecosystem.config.cjs --env production
```

`projects/backend/public/` se sirve tal cual; no incluye secretos ni facturas. Antes de desplegar, aplica el protocolo de respaldo de `AGENTS.md` §5.
