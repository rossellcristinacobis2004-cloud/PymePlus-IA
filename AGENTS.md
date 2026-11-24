# AGENTS.md — Protocolo Estándar y Guía de Arquitectura Multi-Agente

Este documento es la **Guía Maestra y Estándar de Desarrollo** para cualquier Agente de Inteligencia Artificial (OpenCode, Claude, etc.) o estudiante/desarrollador que trabaje en este ecosistema. Define la arquitectura base, buenas prácticas de código, la organización de sub-agentes, el uso de habilidades (`/skills`), persistencia de memoria (`/memory`) y el flujo de despliegue generalizable para proyectos Full Stack y Móviles.

---

## 1. ESTRUCTURA DE CARPETAS DEL ECOSISTEMA Y SUB-AGENTES

Todo proyecto debe organizarse en la raíz siguiendo esta jerarquía modular para garantizar el aislamiento de responsabilidades y el aprendizaje continuo:

```text
/ (Raíz del proyecto)
├── AGENTS.md                   # Instrucciones maestras generales y protocolo global
├── /context/                   # Contexto de negocio y especificaciones
│   ├── system_context.md       # Descripción general, público objetivo y problemas que resuelve
│   ├── business_rules.md       # Reglas de negocio y flujos funcionales
│   └── api_contracts.md        # Definición de endpoints REST y eventos WebSocket
├── /skills/                    # Habilidades y guías metodológicas de ejecución ("Saber Hacer")
│   ├── UI_UX_Design_System.md        # Diseño, fuentes, paletas adaptativas, Bootstrap 5.3+
│   ├── Backend_Architecture_CRUD.md  # Creación de APIs, Mongoose Schemas, Express 5 ESM
│   ├── Frontend_Angular22_Skills.md  # Componentes Standalone, Signals, Control Flow (@if/@for)
│   ├── Mobile_Kotlin_Android.md      # Vistas Native Kotlin, Retrofit, APK version.json
│   ├── Validations_Security.md       # Validaciones V/E, RUT chileno, emails, uploads, JWT
│   ├── Testing_Deployment_Skills.md  # Pruebas, SSH en Ubuntu, respaldos y PM2
│   ├── MCP_External_Connectors.md    # Model Context Protocol: Email, Telegram, Webhooks
│   ├── Authentication_Security_Skill.md # Autenticación JWT, Refresh Tokens, Bcrypt, Login Web/Móvil
│   └── Error_Handling_Human_UX_Skill.md # Manejo global de errores legibles en Backend, SPA y Kotlin
├── /memory/                    # Memoria persistente y aprendizaje del sistema
│   ├── architecture_decisions.md # Historial de decisiones de diseño
│   └── error_solutions.md      # Registro de errores, soluciones y parches aplicados
└── /projects/                  # Espacio de trabajo (Código Fuente)
    ├── /backend                # API REST + Sockets (Node.js 26 ESM + Express 5)
    ├── /frontend               # Aplicación Web (Angular 22+ Standalone + Signals)
    └── /mobile                 # Aplicación Móvil (Android Studio + Kotlin Nativo)
```

---

## 2. ARQUITECTURA TÉCNICA REUTILIZABLE

### A. Backend (`/projects/backend`)
* **Entorno de Ejecución:** Node.js 26+ (ES Modules mediante `"type": "module"` en `package.json`).
* **Framework Web:** Express 5.x con arquitectura modular basada en `/api/<modulo>/`.
* **Base de Datos & ODM:** MongoDB con Mongoose (Modelado de datos flexible NoSQL).
* **Autenticación & Seguridad:** JSON Web Tokens (JWT), encriptación con `bcrypt`, `cors`, `helmet` y limitación de tasa (`express-rate-limit`).
* **Comunicación en Tiempo Real:** Socket.IO para eventos bidireccionales.
* **Procesamiento de Archivos:** `express-fileupload` hacia la estructura de carpetas configurada en `/uploads/`.

### B. Frontend (`/projects/frontend`)
* **Framework:** Angular 22+.
* **Patrón de Diseño:** Componentes Independientes (`standalone: true`), inyección de dependencias con `inject()`, reactividad fina con Angular Signals (`signal()`, `computed()`).
* **Estilos y UX:** Bootstrap 5.3+, iconos modernos (Bootstrap Icons / Lucide), interfaz limpia, adaptable y accesible.
* **Destino de Build:** Los estáticos compilados en producción se copian a `/projects/backend/public/`.

### C. Móvil (`/projects/mobile`)
* **Lenguaje & Entorno:** Kotlin Nativo en Android Studio (Patrón MVVM).
* **Integración API:** Retrofit / OkHttp + Corrutinas.
* **Distribución de Actualizaciones:** Los instaladores generados se publican en `/uploads/apks/` acompañados del manifiesto `version.json`.

---

## 3. ARQUITECTURA BASE DEL BACKEND (`/projects/backend`)

Estructura modular reutilizable por cualquier dominio de software:

```text
/projects/backend
├── /api                        # Módulos del dominio (Controladores, Rutas, Modelos)
│   ├── /auth                   # Autenticación y gestión de tokens
│   ├── /users                  # Usuarios y roles
│   ├── /uploads                # Gestión y entrega de archivos
│   └── /<modulo_dinamico>      # Módulos específicos del proyecto
├── /assets                     # Plantillas, logotipos y recursos estáticos del servidor
├── /bin                        # Servidor HTTP y sockets
│   └── server.js               # Clase plantilla WebServer
├── /databases                  # Conexión a bases de datos (MongoDB/Mongoose)
├── /helpers                    # Funciones utilitarias y validadores
├── /logs                       # Archivos de registro de eventos
├── /microservices              # Conectores externos, MCP y tiempo real
├── /middlewares                # Middlewares (Auth JWT, CORS, Rate Limit)
├── /public                     # Servidor de archivos estáticos (Frontend SPA)
├── /scripts                    # Tareas automatizadas y mantenimiento
├── /seeders                    # Datos de prueba iniciales
├── /uploads                    # Almacenamiento dinámico de archivos
│   ├── /images
│   ├── /documents
│   └── /apks                   # Instaladores móviles y manifiesto version.json
├── .env.example                # Plantilla de variables de entorno sin datos sensibles
├── ecosystem.config.cjs        # Plantilla genérica para PM2
├── index.js                    # Punto de entrada principal
└── package.json
```

---

## 4. PLANTILLAS BASE DE CONFIGURACIÓN

### A. Configuración de PM2 (`ecosystem.config.cjs`)
```javascript
module.exports = {
  apps: [{
    name: process.env.APP_NAME || 'app-template',
    script: './index.js',
    cwd: __dirname,
    watch: false,
    max_memory_restart: '1000M',
    exec_mode: 'fork',
    instances: 1,
    env: {
      NODE_ENV: 'development',
      PORT: process.env.PORT || 3500
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || 3500
    },
    autorestart: true,
    max_restarts: 10,
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }],
};
```

### B. Patrón Estándar de la Clase `WebServer` (`bin/server.js`)
```javascript
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import fileUpload from 'express-fileupload';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class WebServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: { origin: true, credentials: true },
      path: '/socket.io'
    });

    this.app.set('io', this.io);
    this.app.set('trust proxy', 1);

    this.database();
    this.middlewares();
    this.routes();
    this.publics();
  }

  database() {
    // Invocación a la conexión de MongoDB u otra base de datos
  }

  middlewares() {
    this.app.use(helmet({ contentSecurityPolicy: false }));
    this.app.use(cors({ origin: true, credentials: true }));
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use(fileUpload({ useTempFiles: true, tempFileDir: '/tmp/', createParentPath: true }));
  }

  routes() {
    // Registro dinámico de enrutadores del proyecto
  }

  publics() {
    const publicPath = path.join(__dirname, '../public');
    this.app.use(express.static(publicPath));
    this.app.get('/*path', (req, res) => {
      res.sendFile(path.resolve(publicPath, 'index.html'));
    });
  }

  listen() {
    const port = process.env.PORT || 3500;
    this.server.listen(port, () => {
      console.log(`Servidor ejecutándose en el puerto ${port}`);
    });
  }
}

export default WebServer;
```

---

## 5. SUB-AGENTE DE DESPLIEGUE Y PROTOCOLO DE PRODUCCIÓN

El proceso de despliegue se gestiona como un **Sub-Agente de DevOps** desacoplado:

1. **Validación Local:** Ejecución de pruebas y verificación de código en entorno local (`NODE_ENV=development`).
2. **Respaldo Preventivo (Cero Pérdida de Datos):** Antes de actualizar cualquier servidor remoto, ejecutar la rutina de respaldo automatizada:
   ```bash
   FECHA=$(date +%Y%m%d_%H%M%S)
   DIR_BACKUP="${PATH_BACKUPS}/${PROJECT_NAME}_${FECHA}"
   mkdir -p "${DIR_BACKUP}"
   cp -r "${PATH_TARGET}" "${DIR_BACKUP}/source"
   mongodump --uri="${MONGO_URI}" --out="${DIR_BACKUP}/mongodb_dump"
   ```
3. **Construcción del Frontend:** Compilar el proyecto de Angular para producción (`ng build`) y enviar los estáticos a `/projects/backend/public/`.
4. **Sincronización Remota:** Transferir cambios mediante SSH/rsync excluyendo `.env`, `node_modules` y la carpeta `/uploads`.
5. **Reinicio de Procesos con PM2:** Acceder al servidor y recargar el servicio:
   ```bash
   pm2 reload ecosystem.config.cjs --env production
   ```

---

## 6. GESTIÓN Y VERSIONADO DE APLICACIONES MÓVILES (APK)

Cada compilación nativa en Kotlin debe actualizar el manifiesto `/uploads/apks/version.json`:

```json
{
  "appName": "NombreApp",
  "packageName": "com.ejemplo.app",
  "latestVersion": "1.0.0",
  "versionCode": 100,
  "releaseDate": "YYYY-MM-DD",
  "apkUrl": "/uploads/apks/app-release-1.0.0.apk",
  "mandatoryUpdate": false,
  "changelog": [
    "Mejoras de rendimiento",
    "Corrección de errores menores"
  ]
}
```

---

## 7. REGLAS DE USO DE CARPETAS Y SKILLS (`/context`, `/skills`, `/memory`)

Todo Agente de IA (OpenCode, Claude, etc.) o desarrollador DEBE seguir estas reglas operativas:

1. **Modo PLAN (Consulta OBLIGATORIA de Skills):**  
   Antes de generar código, planificar una tarea o responder a un prompt, la IA **debe leer obligatoriamente**:
   * Los archivos de contexto en `/context/` para entender las reglas de negocio específicas del proyecto.
   * La **Skill correspondiente** en `/skills/` según la tarea requerida (ej. `Authentication_Security_Skill.md`, `Backend_Architecture_CRUD.md`, `MCP_External_Connectors.md`).

2. **Modo BUILD (Ejecución de Código):**  
   Al escribir código, se deben aplicar estrictamente los estándares, patrones de diseño y normas descritas en `/skills/`:
   - **Autenticación:** Aplicar `bcrypt`, persistencia de tokens seguros y Login adaptativo.
   - **Gestión de Errores:** Interceptar todas las fallas en backend y envolverlas en mensajes legibles con sugerencias para el usuario antes de mostrarlos en Toast (Angular) o Snackbar (Android).

---

## 8. REGISTRO PERSISTENTE DE MEMORIA (`/memory/`)

Es **obligación** de la IA o del equipo actualizar la memoria cuando ocurra alguno de los siguientes eventos:
1. **Decisión de Arquitectura:** Registrar en `memory/architecture_decisions.md`.
2. **Solución a Bugs / Parches:** Registrar en `memory/error_solutions.md`.
