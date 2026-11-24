import { access, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'dist', 'pymeplus-web', 'browser');
const destination = resolve(root, '..', 'backend', 'public');

try {
  await access(source);
} catch {
  console.error('No se encontró el build. Ejecuta primero: npm run build');
  process.exit(1);
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });

console.log(`Build copiado a ${destination}`);
