import { CUSTOMER_DOCUMENT_TYPES, isValidCustomerDocument } from './pos.component';

describe('validación del cliente obligatorio en el POS', () => {
  it('acepta RIF, cédula y pasaporte con el formato del backend', () => {
    expect(isValidCustomerDocument('RIF', 'J-12345678-9')).toBe(true);
    expect(isValidCustomerDocument('CI', 'V-12345678')).toBe(true);
    expect(isValidCustomerDocument('PASSPORT', 'AB123456')).toBe(true);
  });

  it('rechaza documentos incompletos o inventados', () => {
    expect(isValidCustomerDocument('RIF', 'J-123')).toBe(false);
    expect(isValidCustomerDocument('CI', 'V-123')).toBe(false);
    expect(isValidCustomerDocument('PASSPORT', '----------')).toBe(false);
    expect(isValidCustomerDocument('RIF', '')).toBe(false);
  });

  it('ofrece exactamente los tres tipos de documento del contrato', () => {
    expect(CUSTOMER_DOCUMENT_TYPES).toEqual(['RIF', 'CI', 'PASSPORT']);
  });
});
