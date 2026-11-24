import { formatMoney, round2 } from './money';

describe('money', () => {
  it('redondea 1,005 a 1,01 usando HALF_UP', () => {
    expect(round2(1.005)).toBe(1.01);
  });

  it('muestra siempre símbolo y código de moneda', () => {
    expect(formatMoney(1234.5, 'USD')).toContain('1.234,50');
    expect(formatMoney(1234.5, 'USD')).toContain('USD');
    expect(formatMoney(234, 'VES')).toContain('VES');
  });
});
