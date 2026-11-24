import { Component, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';

import { toApiError } from '../../core/errors/api-error';
import { ApiService } from '../../core/services/api.service';
import { formatMoney, round2 } from '../../shared/money';

interface MoneyValue {
  amount: number;
  currency: 'USD' | 'VES';
}

interface SalesSeriesPoint {
  key: string;
  label: string;
  metrics: { salesCount: number; total: MoneyValue };
}

interface SalesReport {
  summary: { salesCount: number; grossSales: MoneyValue; netSales: MoneyValue };
  series: SalesSeriesPoint[];
}

interface ProfitabilityPoint {
  label: string;
  metrics: { units: number; revenue: MoneyValue };
}

interface ProfitabilityReport {
  series: ProfitabilityPoint[];
}

export interface ReportKpis {
  salesTodayUSD: number;
  operations: number;
  topProduct: string | null;
  topProductUnits: number;
}

export interface ChartBar {
  label: string;
  value: number;
  percent: number;
}

export function todayCaracas(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function buildKpis(sales: SalesReport | null, profitability: ProfitabilityReport | null): ReportKpis {
  const top = [...(profitability?.series ?? [])].sort((a, b) => b.metrics.units - a.metrics.units)[0];

  return {
    salesTodayUSD: round2(Number(sales?.summary?.grossSales?.amount ?? 0)),
    operations: Number(sales?.summary?.salesCount ?? 0),
    topProduct: top?.label ?? null,
    topProductUnits: Number(top?.metrics.units ?? 0),
  };
}

export function buildBars(series: SalesSeriesPoint[]): ChartBar[] {
  const max = Math.max(0, ...series.map((point) => Number(point.metrics?.total?.amount ?? 0)));

  return series.slice(0, 8).map((point) => {
    const value = round2(Number(point.metrics?.total?.amount ?? 0));
    return {
      label: point.label,
      value,
      percent: max > 0 ? round2((value / max) * 100) : 0,
    };
  });
}

@Component({
  selector: 'app-reports',
  standalone: true,
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent {
  private readonly api = inject(ApiService);

  readonly formatMoney = formatMoney;

  readonly sales = signal<SalesReport | null>(null);
  readonly profitability = signal<ProfitabilityReport | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly period = signal(todayCaracas());

  readonly kpis = computed(() => buildKpis(this.sales(), this.profitability()));
  readonly bars = computed(() => buildBars(this.sales()?.series ?? []));

  readonly topProductBars = computed<ChartBar[]>(() => {
    const items = [...(this.profitability()?.series ?? [])]
      .sort((a, b) => b.metrics.units - a.metrics.units)
      .slice(0, 5);
    const max = Math.max(1, ...items.map((item) => Number(item.metrics.units ?? 0)));

    return items.map((item) => ({
      label: item.label,
      value: Number(item.metrics.units ?? 0),
      percent: round2((Number(item.metrics.units ?? 0) / max) * 100),
    }));
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    const day = todayCaracas();
    this.period.set(day);

    forkJoin({
      sales: this.api.get<SalesReport>('/reports/sales', {
        params: { from: day, to: day, currency: 'USD' },
      }),
      profitability: this.api.get<ProfitabilityReport>('/reports/profitability', {
        params: { from: day, to: day, currency: 'USD' },
      }),
    }).subscribe({
      next: ({ sales, profitability }) => {
        this.sales.set(sales);
        this.profitability.set(profitability);
      },
      error: (error: unknown) => {
        const apiError = toApiError(error);
        this.errorMessage.set(apiError.userMessage);
        this.loading.set(false);
      },
      complete: () => this.loading.set(false),
    });
  }
}
