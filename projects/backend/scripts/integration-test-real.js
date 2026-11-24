// envoltorio para ejecutar la misma suite contra un MongoDB real.
process.env.USE_EXTERNAL_MONGO = '1';
await import('./integration-test.js');
