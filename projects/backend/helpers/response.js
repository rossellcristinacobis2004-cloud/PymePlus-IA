/** ISO 8601 con offset fijo de Venezuela (America/Caracas no tiene horario de verano). */
export function nowIso() {
  return new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString().replace('Z', '-04:00');
}

/** Fecha local de Venezuela en formato YYYY-MM-DD. */
export function todayCaracas() {
  return new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function ok(res, { data = null, message = 'Operación exitosa.', status = 200, meta = {} } = {}) {
  return res.status(status).json({
    success: true,
    message,
    data,
    meta: { requestId: res.req?.headers?.['x-request-id'] || null, timestamp: nowIso(), ...meta },
    errors: []
  });
}

export function created(res, data, message = 'Recurso creado correctamente.', meta = {}) {
  return ok(res, { data, message, status: 201, meta });
}

export function paginate({ page = 1, limit = 20, total = 0 }) {
  const currentPage = Math.max(1, Number(page));
  const perPage = Math.min(100, Math.max(1, Number(limit)));
  return {
    page: currentPage,
    limit: perPage,
    total,
    totalPages: Math.ceil(total / perPage),
    hasNext: currentPage * perPage < total
  };
}
