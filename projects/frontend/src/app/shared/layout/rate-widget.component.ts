import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';

import { RateSnapshot } from '../../core/models/rate.model';
import { ApiService } from '../../core/services/api.service';
import { SocketService } from '../../core/services/socket.service';
import { formatMoney } from '../money';

type RateState = 'ACTIVE' | 'STALE' | 'EXPIRED';

/** Widget del topbar: tasa vigente con refresco por socket y polling de respaldo. */
@Component({
  selector: 'app-rate-widget',
  standalone: true,
  templateUrl: './rate-widget.component.html',
  styleUrl: './rate-widget.component.scss',
})
export class RateWidgetComponent {
  private readonly api = inject(ApiService);
  private readonly socket = inject(SocketService);

  readonly rate = signal<RateSnapshot | null>(null);
  readonly error = signal(false);
  readonly formatMoney = formatMoney;

  readonly isFallback = computed(() => Boolean(this.rate()?.isFallback));

  readonly ageHours = computed(() => {
    const capturedAt = this.rate()?.capturedAt;
    if (!capturedAt) return 0;
    return Math.max(0, (Date.now() - new Date(capturedAt).getTime()) / 3_600_000);
  });

  readonly status = computed<RateState>(() => {
    const age = this.ageHours();
    if (age > 72) return 'EXPIRED';
    if (age > 48) return 'STALE';
    return 'ACTIVE';
  });

  constructor() {
    interval(1_800_000)
      .pipe(
        startWith(0),
        switchMap(() => this.api.get<RateSnapshot>('/exchange-rates/current').pipe(catchError(() => of(null)))),
        takeUntilDestroyed(),
      )
      .subscribe((rate) => {
        this.rate.set(rate);
        this.error.set(!rate);
      });

    this.socket.rateUpdates.pipe(takeUntilDestroyed()).subscribe((rate) => {
      this.rate.set({ ...rate, ageHours: 0 });
      this.error.set(false);
    });
  }
}
