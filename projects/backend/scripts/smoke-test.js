import assert from 'node:assert/strict';
import WebServer from '../bin/server.js';

process.env.PORT = '0';
process.env.NODE_ENV = 'test';

const server = new WebServer();
server.listen();

await new Promise((resolve) => server.server.once('listening', resolve));
const port = server.server.address().port;
const base = `http://127.0.0.1:${port}`;

const checks = [];

async function check(name, pathname, expectedStatus, validator) {
  const response = await fetch(`${base}${pathname}`);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  assert.equal(response.status, expectedStatus, `${name}: estado inesperado (${response.status})`);
  if (validator) validator(body, response);
  checks.push(name);
}

try {
  await check('health', '/api/health', 200, (body) => {
    assert.equal(body.success, true);
    assert.equal(body.data.app, process.env.APP_NAME || 'PymePlus IA');
    assert.match(body.meta.timestamp, /-04:00$/);
  });

  await check('raíz SPA', '/', 200, (body) => {
    assert.match(body, /PymePlus IA/);
  });

  await check('ruta SPA', '/clientes/123', 200);

  await check('404 API', '/api/ruta-inexistente', 404, (body) => {
    assert.equal(body.success, false);
    assert.equal(body.errors[0].code, 'NOT_FOUND');
    assert.ok(body.userMessage);
  });

  await check('sin autenticación', '/api/products', 401, (body) => {
    assert.equal(body.errors[0].code, 'UNAUTHORIZED');
  });

  await check('Socket.IO handshake', '/socket.io/?EIO=4&transport=polling', 200);

  console.log(`SMOKE OK (${checks.length}): ${checks.join(', ')}`);
  process.exitCode = 0;
} catch (error) {
  console.error('SMOKE FAIL:', error.message);
  process.exitCode = 1;
} finally {
  await server.close();
}
