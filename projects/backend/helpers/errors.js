/** Error de dominio con formato compatible con el sobre de api_contracts.md. */
export class ApiError extends Error {
  constructor(status, code, message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.userMessage = options.userMessage || message;
    this.suggestion = options.suggestion || 'Revisa los datos e inténtalo de nuevo.';
    this.field = options.field || null;
    this.retryable = options.retryable ?? false;
  }
}

export const badRequest = (message, options = {}) =>
  new ApiError(400, 'VALIDATION_ERROR', message, options);

export const unauthorized = (message = 'Credenciales inválidas.') =>
  new ApiError(401, 'UNAUTHORIZED', message, {
    userMessage: 'Debes iniciar sesión para continuar.',
    suggestion: 'Ingresa con tu usuario y contraseña.'
  });

export const forbidden = (message = 'No tienes permiso para esta acción.', options = {}) =>
  new ApiError(403, 'FORBIDDEN', message, {
    userMessage: 'Tu usuario no tiene permiso para realizar esta acción.',
    suggestion: 'Solicita permisos a un administrador.',
    ...options
  });

export const notFound = (resource = 'Recurso') =>
  new ApiError(404, 'NOT_FOUND', `${resource} no encontrado.`, {
    userMessage: `No encontramos ${resource.toLowerCase()}.`,
    suggestion: 'Verifica el identificador e inténtalo de nuevo.'
  });

export const conflict = (code, message, options = {}) =>
  new ApiError(409, code, message, options);

/**
 * Traduce errores de librerías (Mongoose, express.json) a errores de dominio.
 * Así una entrada malformada nunca termina en un 500 con stack trace.
 */
export function normalizeError(error) {
  if (!error) return error;
  if (error instanceof ApiError) return error;

  if (error.name === 'CastError') {
    return badRequest(`El valor del campo ${error.path} no es válido.`, {
      field: error.path,
      userMessage: `Revisa el campo ${error.path}.`,
      suggestion: 'Verifica el formato del dato e inténtalo de nuevo.'
    });
  }

  if (error.name === 'ValidationError') {
    const [field] = Object.keys(error.errors || {});
    const detail = field ? error.errors[field].message : error.message;
    return badRequest('Uno o más campos no son válidos.', {
      field: field || null,
      userMessage: 'Revisa los datos del formulario.',
      suggestion: detail
    });
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return badRequest('El JSON enviado no es válido.', {
      field: 'body',
      userMessage: 'No pudimos leer los datos enviados.',
      suggestion: 'Verifica el formato JSON e inténtalo de nuevo.'
    });
  }

  if (error.type === 'entity.too.large') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'La petición es demasiado grande.', {
      userMessage: 'Los datos enviados son demasiado grandes.',
      suggestion: 'Reduce el tamaño de la petición.'
    });
  }

  return error;
}
