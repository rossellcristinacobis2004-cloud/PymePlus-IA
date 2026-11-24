import { formatUserDate, isValidUserEmail, roleLabel } from './users-list.component';

describe('utilidades del panel de usuarios', () => {
  it('muestra etiquetas legibles para los roles', () => {
    expect(roleLabel('ADMIN')).toBe('Administrador');
    expect(roleLabel('CASHIER')).toBe('Cajero');
    expect(roleLabel('WAREHOUSE')).toBe('Almacén');
    expect(roleLabel('FINANCE')).toBe('Finanzas');
  });

  it('valida correos antes de enviar el alta', () => {
    expect(isValidUserEmail('cajero@pymeplus.local')).toBe(true);
    expect(isValidUserEmail('correo-invalido')).toBe(false);
    expect(isValidUserEmail('  supervisor@pymeplus.local  ')).toBe(true);
  });

  it('formatea fechas en zona America/Caracas y marca ausencia de ingreso', () => {
    expect(formatUserDate(null)).toBe('Nunca');
    expect(formatUserDate('no-es-fecha')).toBe('—');
    expect(formatUserDate('2026-11-24T15:30:00.000Z')).toMatch(/24\/11\/2026/);
  });
});
