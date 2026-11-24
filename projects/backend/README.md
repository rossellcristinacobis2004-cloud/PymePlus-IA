# PymePlus IA — Backend

[← Volver al README principal](../../README.md)

API REST + Socket.IO para el sistema POS y de inventario de PymePlus IA.

**Stack:** Node.js 26 · ESM · Express 5 · MongoDB/Mongoose 9 · Socket.IO 4 · JWT + bcryptjs.

## Requisitos
- Node.js ≥ 26
- MongoDB (replica set; las ventas usan transacciones multi-documento)

## Instalación
```bash
npm install
cp .env.example .env     # Windows: Copy-Item .env.example .env
# Edita .env: MONGO_URI, JWT_SECRET, FALLBACK_BCV_RATE
npm run seed             # crea admin, tasa BCV y datos de prueba
npm start
```

El servidor escucha en `http://0.0.0.0:3500` por defecto.

## Scripts
| Script | Descripción |
|---|---|
| `npm start` | Inicia el servidor |
| `npm run dev` | Inicia con recarga automática |
| `npm test` | Pruebas unitarias de reglas de negocio |
| `npm run test:smoke` | Pruebas HTTP sin base de datos |
| `npm run test:integration` | Pruebas end-to-end con MongoDB en memoria |
| `npm run seed` | Carga datos base |
| `npm run migrate` | Convierte categorías antiguas de producto a `String` |

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | Inicio de sesión (devuelve JWT y refresh token) |
| POST | `/api/auth/refresh` | Renovación de sesión con rotación de refresh token |
| POST | `/api/auth/forgot-password` | Solicitud de restablecimiento de contraseña |
| POST | `/api/auth/reset-password` | Restablecimiento con token de un solo uso |
| GET | `/api/auth/me` | Usuario autenticado |
| GET/POST | `/api/products` | Listado / creación |
| GET | `/api/products/barcode/:barcode` | Búsqueda por escáner |
| GET | `/api/products/low-stock` | Stock bajo |
| GET | `/api/products/expiring?days=30` | Próximos a vencer |
| PATCH/DELETE | `/api/products/:id` | Actualización / baja lógica |
| POST | `/api/products/:id/stock-adjustments` | Ajuste auditado |
| GET/POST | `/api/sales` | Listado / registro atómico |
| POST | `/api/sales/:id/void` | Anulación con reversión |
| POST | `/api/sales/:id/resend-invoice` | Reenvío de factura (202 si queda encolada) |
| GET | `/api/exchange-rates/current` | Tasa BCV vigente o fallback marcado |
| GET | `/api/exchange-rates/history` | Historial paginado de tasas |
| POST | `/api/exchange-rates` | Alta manual de tasa (ADMIN o FINANCE) |
| GET | `/api/sales/:id/invoice.pdf` | Factura PDF |
| GET/POST | `/api/customers` | Clientes |
| GET | `/api/customers/:id/statement` | Estado de cuenta |
| GET | `/api/reports/{sales,iva,inventory-valuation,profitability,replenishment}` | Reportes |
| GET | `/api/reports/:key/export?format=pdf\|csv` | Exportación |
| GET | `/api/health` | Estado del servicio |

## Convenciones
- Todas las respuestas usan el sobre `{ success, message, data, meta, errors }`.
- Los montos son objetos `Money`: `{ amount, currency, rateUsed }`.
- `POST /api/sales` exige el header `X-Idempotency-Key` (UUID).
- USD es la moneda base; VES se deriva de la tasa BCV y se guarda un `rateSnapshot` por venta.
- El detalle está en `/context/api_contracts.md` y `/context/business_rules.md`.

## Despliegue
```bash
pm2 start ecosystem.config.cjs --env production
# o, con MongoDB replica set incluido:
docker compose up -d --build
```
Antes de desplegar, ejecutar el protocolo de respaldo descrito en `AGENTS.md` §5. En producción, publicar la API solo detrás de un reverse proxy con HTTPS (TLS terminado en Nginx o el balanceador); no incluir certificados ni claves en el repositorio. Revisar `MONGO_URI`, `JWT_SECRET` y `JWT_REFRESH_SECRET` en el entorno del servidor.
