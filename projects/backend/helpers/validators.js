import { badRequest } from './errors.js';

const BARCODE_RE = /^[0-9]{8,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RIF_RE = /^[JGVPE]-[0-9]{8}-[0-9]$/i;
const CI_RE = /^[VE]-[0-9]{7,8}$/i;
// Debe contener al menos un carácter alfanumérico: "----------" no es un pasaporte.
const PASSPORT_RE = /^(?=.*[A-Z0-9])[A-Z0-9-]{6,20}$/;

export function requireString(value, field, { min = 1, max = 200 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw badRequest(`El campo ${field} no es válido.`, {
      field,
      userMessage: `Revisa el campo ${field}.`,
      suggestion: `Debe tener entre ${min} y ${max} caracteres.`
    });
  }
  return value.trim();
}

export function requirePositiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw badRequest(`El campo ${field} debe ser un número mayor que cero.`, {
      field,
      userMessage: `El valor de ${field} no es válido.`,
      suggestion: 'Ingresa un número positivo.'
    });
  }
  return number;
}

export function validateBarcode(value) {
  const barcode = String(value || '').trim();
  if (!BARCODE_RE.test(barcode)) {
    throw badRequest('Código de barras inválido.', {
      field: 'barcode',
      codeHint: 'INVALID_BARCODE',
      userMessage: 'El código de barras no tiene un formato reconocido.',
      suggestion: 'Usa un código EAN-13, UPC-A o Code 128 numérico.'
    });
  }
  return barcode;
}

export function validateEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw badRequest('Correo electrónico inválido.', {
      field: 'email',
      userMessage: 'El correo electrónico no es válido.',
      suggestion: 'Incluye el formato nombre@dominio.com.'
    });
  }
  return email;
}

export function validateDocument(documentType, documentNumber) {
  const type = String(documentType || '').toUpperCase();
  const number = String(documentNumber || '').trim().toUpperCase();

  if (!['RIF', 'CI', 'PASSPORT'].includes(type)) {
    throw badRequest('Tipo de documento inválido.', {
      field: 'documentType',
      userMessage: 'Selecciona un tipo de documento válido.',
      suggestion: 'Opciones: RIF, CI o PASSPORT.'
    });
  }

  const valid = type === 'RIF' ? RIF_RE.test(number) : type === 'CI' ? CI_RE.test(number) : PASSPORT_RE.test(number);
  if (!valid) {
    throw badRequest('Número de documento inválido.', {
      field: 'documentNumber',
      userMessage: 'El número de documento no es válido.',
      suggestion: type === 'RIF' ? 'Formato esperado: J-12345678-9.' : 'Revisa el número e inténtalo de nuevo.'
    });
  }

  return { documentType: type, documentNumber: number };
}

/**
 * Valida el documento identificador de una venta.
 * Acepta RIF (J-12345678-9), Cédula (V-12345678) y pasaporte alfanumérico.
 * El nombre `customerRUT` se conserva por compatibilidad con el contrato solicitado.
 */
export function parseCustomerRUT(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return null;
  if (RIF_RE.test(text)) return validateDocument('RIF', text).documentNumber;
  if (CI_RE.test(text)) return validateDocument('CI', text).documentNumber;
  if (PASSPORT_RE.test(text)) return validateDocument('PASSPORT', text).documentNumber;

  throw badRequest('Documento de identidad inválido.', {
    field: 'customerRUT',
    userMessage: 'El RIF, la cédula o el pasaporte no son válidos.',
    suggestion: 'Usa formatos como J-12345678-9 o V-12345678.'
  });
}

/** Número finito dentro de un rango; evita NaN e Infinity en la base de datos. */
export function requireNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (
    value === '' ||
    value === null ||
    value === undefined ||
    !Number.isFinite(number) ||
    number < min ||
    number > max
  ) {
    throw badRequest(`El campo ${field} no es válido.`, {
      field,
      userMessage: `Revisa el campo ${field}.`,
      suggestion: `Usa un número entre ${min} y ${max}.`
    });
  }
  return number;
}

/** Entero positivo para paginación, con valor por defecto y tope. */
export function positiveInt(value, field, fallback, max = 100) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw badRequest(`El campo ${field} no es válido.`, {
      field,
      userMessage: `Revisa el campo ${field}.`,
      suggestion: `Usa un entero entre 1 y ${max}.`
    });
  }
  return number;
}

/** Fecha de filtro: rechaza cadenas como "basura" antes de tocar Mongoose. */
export function dateParam(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim();
  const parsed = new Date(text);
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const validFormat = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text);
  if (
    !validFormat ||
    Number.isNaN(parsed.getTime()) ||
    (isDateOnly && parsed.toISOString().slice(0, 10) !== text)
  ) {
    throw badRequest(`La fecha ${field} no es válida.`, {
      field,
      userMessage: `Revisa la fecha ${field}.`,
      suggestion: 'Usa el formato YYYY-MM-DD.'
    });
  }
  return parsed;
}
