import { badRequest } from './errors.js';

const BARCODE_RE = /^[0-9]{8,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RIF_RE = /^[JGVPE]-[0-9]{8}-[0-9]$/i;
const CI_RE = /^[VE]-[0-9]{7,8}$/i;

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

  const valid = type === 'RIF' ? RIF_RE.test(number) : type === 'CI' ? CI_RE.test(number) : number.length >= 6;
  if (!valid) {
    throw badRequest('Número de documento inválido.', {
      field: 'documentNumber',
      userMessage: 'El número de documento no es válido.',
      suggestion: type === 'RIF' ? 'Formato esperado: J-12345678-9.' : 'Revisa el número e inténtalo de nuevo.'
    });
  }

  return { documentType: type, documentNumber: number };
}
