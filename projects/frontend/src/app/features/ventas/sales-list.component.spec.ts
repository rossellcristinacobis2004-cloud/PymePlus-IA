import { formatSaleDate } from './sales-list.component';

describe('formatSaleDate', () => {
  it('muestra una fecha inválida como guion', () => {
    expect(formatSaleDate('no-es-fecha')).toBe('—');
  });

  it('formatea la fecha en zona America/Caracas', () => {
    const formatted = formatSaleDate('2026-11-24T15:30:00.000Z');
    expect(formatted).toMatch(/24\/11\/2026/);
    expect(formatted).toMatch(/11:30/);
  });
});
