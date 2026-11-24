<div align="center">

# PymePlus IA

API REST y Socket.IO para la gestión de ventas, inventario y clientes de pequeñas y medianas empresas.

![Node.js](https://img.shields.io/badge/Node.js-26.13-339933?logo=node.js&logoColor=white)
![npm](https://img.shields.io/badge/npm-11.20-CB3837?logo=npm&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.3-000000?logo=express&logoColor=white)
![Mongoose](https://img.shields.io/badge/Mongoose-9.13-47A248?logo=mongodb&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-010E2C?logo=socketdotio&logoColor=white)
![Verificaciones](https://img.shields.io/badge/verificaciones-31%2F31%20OK-brightgreen)

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
    ├── backend/              API REST + Socket.IO
    ├── frontend/             Aplicación web (reservado)
    └── mobile/               Aplicación móvil (reservado)
```

## Requisitos

| Requisito | Versión |
|---|---|
| Node.js | 26.0.0 o superior (verificado con 26.13.0) |
| npm | 11.0.0 o superior (verificado con 11.20.0) |
| MongoDB | Replica set; las ventas usan transacciones multi-documento |

## Instalación

```bash
cd projects/backend
npm install
cp .env.example .env
npm run seed
npm start
```

En Windows, usa `Copy-Item .env.example .env` en lugar de `cp`. Configura el archivo `.env` antes de iniciar el servidor. El healthcheck queda disponible en `GET /api/health`.

## Pruebas

```bash
npm test
npm run test:smoke
npm run test:integration
```

Resultados: 11 pruebas unitarias, 6 comprobaciones HTTP y 14 verificaciones de integración, todas correctas.

## Enlaces

- [Backend y endpoints](projects/backend/README.md)
- [Contratos de API](context/api_contracts.md)
- [Reglas de negocio](context/business_rules.md)
