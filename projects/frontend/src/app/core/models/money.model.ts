import { RateSnapshot } from './rate.model';

export type Currency = 'USD' | 'VES';

export interface Money {
  amount: number;
  currency: Currency;
  rateUsed: RateSnapshot | null;
}
