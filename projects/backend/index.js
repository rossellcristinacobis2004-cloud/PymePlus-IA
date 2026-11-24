import 'dotenv/config';
import { disconnectDatabase } from './databases/mongodb.js';
import WebServer from './bin/server.js';

const webServer = new WebServer();
webServer.listen();

let shuttingDown = false;

/**
 * Cierre controlado: deja de aceptar peticiones, cierra Socket.IO/HTTP
 * y desconecta Mongoose antes de terminar el proceso.
 */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n[SHUTDOWN] Señal ${signal} recibida. Cerrando PymePlus IA...`);

  try {
    await webServer.close();
    await disconnectDatabase();
    console.log('[SHUTDOWN] Cierre completado correctamente.');
    process.exit(0);
  } catch (error) {
    console.error('[SHUTDOWN] Error durante el cierre:', error.message);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Excepción no controlada:', error);
  process.exit(1);
});
