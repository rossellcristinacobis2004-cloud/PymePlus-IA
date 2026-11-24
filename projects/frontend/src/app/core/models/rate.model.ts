export interface RateSnapshot {
  value: number;
  source: string;
  date: string;
  capturedAt: string;
  isFallback: boolean;
  status?: string;
  ageHours?: number;
  reason?: string | null;
  sourceUpdatedAt?: string | null;
}
