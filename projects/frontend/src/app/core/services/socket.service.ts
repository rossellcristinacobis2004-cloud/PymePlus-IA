import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

import { RateSnapshot } from '../models/rate.model';
import { TokenService } from './token.service';

export interface StockEvent {
  productId: string;
  sku: string;
  available: number;
  delta: number;
  reason: string;
}

@Injectable({ providedIn: 'root' })
export class SocketService {
  private readonly tokens = inject(TokenService);
  private socket: Socket | null = null;
  private connectedToken: string | null = null;

  private readonly stockSubject = new Subject<StockEvent>();
  private readonly lowStockSubject = new Subject<StockEvent>();
  private readonly invoiceSubject = new Subject<{ saleId: string; invoiceNumber: string }>();
  private readonly rateSubject = new Subject<RateSnapshot>();

  readonly stockUpdates = this.stockSubject.asObservable();
  readonly lowStockAlerts = this.lowStockSubject.asObservable();
  readonly invoiceReady = this.invoiceSubject.asObservable();
  readonly rateUpdates = this.rateSubject.asObservable();

  /** Idempotente: varios componentes pueden pedir la conexión sin duplicar sockets. */
  connect(): void {
    const token = this.tokens.accessToken();
    if (this.socket && this.connectedToken === (token ?? null)) return;

    this.disconnect();
    this.connectedToken = token ?? null;
    this.socket = io({
      path: '/socket.io',
      autoConnect: true,
      transports: ['websocket', 'polling'],
      auth: token ? { token } : {},
    });

    this.socket.on('stock:updated', (payload: StockEvent) => this.stockSubject.next(payload));
    this.socket.on('stock_updated', (payload: StockEvent) => this.stockSubject.next(payload));
    this.socket.on('stock:low', (payload: StockEvent) => this.lowStockSubject.next(payload));
    this.socket.on('invoice:ready', (payload: { saleId: string; invoiceNumber: string }) =>
      this.invoiceSubject.next(payload),
    );
    this.socket.on('exchangeRate:updated', (payload: RateSnapshot) => this.rateSubject.next(payload));
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connectedToken = null;
  }
}
