import { buildBars, buildKpis, todayCaracas } from './reports.component';

function money(amount: number) {
  return { amount, currency: 'USD' as const };
}

describe('reportes helpers', () => {
  it('calcula los KPI desde el sobre de reportes', () => {
    const kpis = buildKpis(
      {
        summary: { salesCount: 7, grossSales: money(120.5), netSales: money(103.88) },
        series: [],
      },
      {
        series: [
          { label: 'Aceite', metrics: { units: 4, revenue: money(40) } },
          { label: 'Agua', metrics: { units: 9, revenue: money(18) } },
        ],
      },
    );

    expect(kpis.salesTodayUSD).toBe(120.5);
    expect(kpis.operations).toBe(7);
    expect(kpis.topProduct).toBe('Agua');
    expect(kpis.topProductUnits).toBe(9);
  });

  it('devuelve KPI vacíos cuando no hay datos', () => {
    expect(buildKpis(null, null)).toEqual({
      salesTodayUSD: 0,
      operations: 0,
      topProduct: null,
      topProductUnits: 0,
    });
  });

  it('construye barras con porcentaje relativo al máximo', () => {
    const bars = buildBars([
      { key: 'lun', label: 'lun', metrics: { salesCount: 1, total: money(10) } },
      { key: 'mar', label: 'mar', metrics: { salesCount: 2, total: money(40) } },
    ]);

    expect(bars.map((bar) => bar.percent)).toEqual([25, 100]);
  });

  it('usa la fecha de Caracas para el periodo', () => {
    expect(todayCaracas(new Date('2026-11-24T15:30:00.000Z'))).toBe('2026-11-24');
  });
});
