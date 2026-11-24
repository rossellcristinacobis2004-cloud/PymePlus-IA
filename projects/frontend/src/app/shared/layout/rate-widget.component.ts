import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';

import { RateSnapshot } from '../../core/models/rate.model';
import { ApiService } from '../../core/services/api.service';
import { formatMoney } from '../money';

type RateState = 'ACTIVE' | 'STALE' | 'EXPIRED';

/** Widget del topbar: consulta la tasa BCV y la refresca sin recargar la SPA. */
@Component({
  selector: 'app-rate-widget',
  standalone: true,
  templateUrl: './rate-widget.component.html',
  styleUrl: './rate-widget.component.scss',
})
export class RateWidgetComponent {
  private readonly api = inject(ApiService);

  readonly rate = signal<RateSnapshot | null>(null);
  readonly error = signal(false);
  readonly formatMoney = formatMoney;

  readonly status = computed<RateState>(() => {
    const age = this.rate()?.ageHours ?? 0;
    if (age > 72) return 'EXPIRED';
    if (age > 48) return 'STALE';
    return 'ACTIVE';
  });

  constructor() {
    interval(300_000)
      .pipe(
        startWith(0),
        switchMap(() => this.api.get<RateSnapshot>('/exchange-rates/current').pipe(catchError(() => of(null)))),
        takeUntilDestroyed(),
      )
      .subscribe((rate) => {
        this.rate.set(rate);
        this.error.set(!rate);
      });
  }
}
