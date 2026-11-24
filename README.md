<div align="center">

# PymePlus IA

API REST, Socket.IO y aplicación web POS para la gestión de ventas, inventario y clientes de pequeñas y medianas empresas.

![Node.js](https://img.shields.io/badge/Node.js-26.13-339933?logo=node.js&logoColor=white)
![npm](https://img.shields.io/badge/npm-11.20-CB3837?logo=npm&logoColor=white)
![Angular](https://img.shields.io/badge/Angular-22.2-DD0031?logo=angular&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.3-000000?logo=express&logoColor=white)
![Mongoose](https://img.shields.io/badge/Mongoose-9.13-47A248?logo=mongodb&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-010E2C?logo=socketdotio&logoColor=white)
![Verificaciones](https://img.shields.io/badge/verificaciones-backend%2020%2F20%20%C2%B7%20frontend%2011%2F11-brightgreen)

[Repositorio](https://github.com/rossellcristinacobis2004-cloud/PymePlus-IA) · [Documentación funcional](context/system_context.md)

</div>

---

## Estructura

```text
PymePlus-IA/
├── AGENTS.md                 Guía maestra y protocolo de desarrollo
├── context/                  Contexto de negocio y contratos
│   ├── system_context.md
│   ├── business_rules.md
│   └── api_contracts.md
├── skills/                   Guías metodológicas
├── memory/                   Decisiones de arquitectura y soluciones
└── projects/
    ├── backend/              API REST + Socket.IO + estáticos de la SPA
    ├── frontend/             SPA Angular 22 — POS implementado
    └── mobile/               Aplicación móvil (reservado)
```

## Requisitos

| Requisito | Versión |
|---|---|
| Node.js | 26.0.0 o superior (verificado con 26.13.0) |
| npm | 11.0.0 o superior (verificado con 11.20.0) |
| MongoDB | Replica set; las ventas usan transacciones multi-documento |

## Instalación

Backend:

```bash
cd projects/backend
npm install
cp .env.example .env
npm run seed
npm start
```

Frontend, en otra terminal:

```bash
cd projects/frontend
npm install
npm start
```

La SPA queda en `http://localhost:4200/` y el proxy de desarrollo (`proxy.conf.json`) envía `/api` y `/socket.io` al backend en `http://127.0.0.1:3500`.

En Windows, usa `Copy-Item .env.example .env` en lugar de `cp`. Configura el `.env` del backend antes de sembrar o iniciar el servidor. El healthcheck queda disponible en `GET /api/health`.

> **Seguridad:** usa secretos de al menos 32 caracteres en producción (`JWT_SECRET`, `JWT_REFRESH_SECRET`); `TRUST_PROXY` por defecto es `false` y solo debe activarse detrás de un proxy de confianza. El seeder está bloqueado cuando `NODE_ENV=production` y no sobrescribe la contraseña de un administrador existente. Las facturas se escriben en `projects/backend/var/invoices/` (ignorado por Git) y solo se descargan por `GET /api/sales/:id/invoice.pdf` con JWT.

## Build de producción

```bash
cd projects/frontend
npm run build:backend
```

Ese comando compila Angular y copia el resultado a `projects/backend/public/`, de donde el backend sirve la SPA. No edites `public/` a mano. El fallback de rutas del backend devuelve `index.html` para rutas de la SPA, pero `/api/*` desconocido responde JSON.

## Pruebas

Backend, desde `projects/backend`:

```bash
npm test
npm run test:smoke
npm run test:integration
npm run test:integration:real   # requiere MongoDB rs0; limpia su DB temporal
npm audit --audit-level=high
```

Frontend, desde `projects/frontend`:

```bash
npm test -- --watch=false
npm run build
npm audit --audit-level=high
```

Resultados de la última verificación: 41 pruebas unitarias, 6 comprobaciones HTTP, 75 verificaciones de integración en memoria y 75 contra MongoDB real; 11 pruebas frontend. Todas correctas. Ejecuta `npm audit` dentro de cada proyecto: desde la raíz falla con `ENOLOCK`.

GitHub Actions ejecuta `backend-tests.yml` y `frontend-tests.yml` de forma independiente según las rutas cambiadas.

## Enlaces

- [Backend y endpoints](projects/backend/README.md)
- [Frontend POS](projects/frontend/README.md)
- [Contratos de API](context/api_contracts.md)
- [Reglas de negocio](context/business_rules.md)
- [Decisiones de arquitectura](memory/architecture_decisions.md)
