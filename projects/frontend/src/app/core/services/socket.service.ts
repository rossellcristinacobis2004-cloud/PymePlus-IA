import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

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

  private readonly stockSubject = new Subject<StockEvent>();
  private readonly lowStockSubject = new Subject<StockEvent>();
  private readonly invoiceSubject = new Subject<{ saleId: string; invoiceNumber: string }>();

  readonly stockUpdates = this.stockSubject.asObservable();
  readonly lowStockAlerts = this.lowStockSubject.asObservable();
  readonly invoiceReady = this.invoiceSubject.asObservable();

  connect(): void {
    this.disconnect();

    const token = this.tokens.accessToken();
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
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
