import { afterNextRender, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';

import { ApiService } from '../../core/services/api.service';
import { TokenService } from '../../core/services/token.service';
import { ToastService } from '../../core/services/toast.service';
import { SocketService, StockEvent } from '../../core/services/socket.service';
import { toApiError } from '../../core/errors/api-error';
import { Currency } from '../../core/models/money.model';
import { Product } from '../../core/models/product.model';
import { RateSnapshot } from '../../core/models/rate.model';
import { Sale } from '../../core/models/sale.model';
import { calculateCart } from '../../shared/cart';
import { formatMoney, round2 } from '../../shared/money';
import { CartStore } from './cart.store';

type RateStatus = 'ACTIVE' | 'STALE' | 'EXPIRED';

@Component({
  selector: 'app-pos',
  standalone: true,
  templateUrl: './pos.component.html',
  styleUrl: './pos.component.scss',
  providers: [CartStore],
})
export class PosComponent {
  private readonly api = inject(ApiService);
  private readonly tokens = inject(TokenService);
  private readonly toasts = inject(ToastService);
  private readonly socket = inject(SocketService);

  readonly cart = inject(CartStore);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  readonly formatMoney = formatMoney;
  readonly round2 = round2;

  readonly paymentMethods = ['Efectivo USD', 'Pago Móvil', 'Punto de Venta', 'Zelle'] as const;

  readonly products = signal<Product[]>([]);
  readonly search = signal('');
  readonly rate = signal<RateSnapshot | null>(null);
  readonly currency = signal<Currency>('USD');
  readonly paymentMethod = signal<string>('Efectivo USD');
  readonly paidAmount = signal(0);
  readonly submitting = signal(false);
  readonly checkoutOpen = signal(false);
  readonly loading = signal(true);
  readonly lastSale = signal<Sale | null>(null);
  readonly idempotencyKey = signal<string | null>(null);

  readonly filteredProducts = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.products().slice(0, 12);
    return this.products()
      .filter(
        (product) =>
          product.name.toLowerCase().includes(term) ||
          product.sku.toLowerCase().includes(term) ||
          (product.barcode || '').includes(term),
      )
      .slice(0, 12);
  });

  readonly totals = computed(() => calculateCart(this.cart.lines(), this.currency(), this.rate()));

  readonly change = computed(() => round2(this.paidAmount() - this.totals().total));

  readonly rateStatus = computed<RateStatus>(() => {
    const age = this.rate()?.ageHours ?? 0;
    if (age > 72) return 'EXPIRED';
    if (age > 48) return 'STALE';
    return 'ACTIVE';
  });

  readonly canChargeVes = computed(() => this.rateStatus() === 'ACTIVE');
  readonly canCharge = computed(() => this.rateStatus() !== 'EXPIRED');

  constructor() {
    afterNextRender(() => this.searchInput()?.nativeElement.focus());

    if (this.tokens.isAuthenticated()) this.socket.connect();
    this.loadCatalog();

    this.socket.stockUpdates.pipe(takeUntilDestroyed()).subscribe((event) => this.applyStockEvent(event));
    this.socket.lowStockAlerts.pipe(takeUntilDestroyed()).subscribe((event) => {
      this.toasts.warning(`${event.sku} alcanzó su stock mínimo (${event.available}).`);
    });
    this.socket.invoiceReady.pipe(takeUntilDestroyed()).subscribe((event) => {
      this.toasts.info(`Factura ${event.invoiceNumber} lista para descargar.`);
    });
  }

  onSearchInput(value: string): void {
    this.search.set(value);
  }

  openCheckout(): void {
    if (!this.cart.isEmpty()) this.checkoutOpen.set(true);
  }

  closeCheckout(): void {
    this.checkoutOpen.set(false);
  }

  lookupBarcode(): void {
    const code = this.search().trim();
    if (!code) return;

    this.api.get<Product>(`/products/barcode/${encodeURIComponent(code)}`).subscribe({
      next: (product) => this.addProduct(product),
      error: (error: unknown) => {
        const apiError = toApiError(error);
        this.toasts.error(apiError.userMessage, apiError.suggestion);
      },
    });
  }

  addProduct(product: Product): void {
    const available = Number(product.stock.available) || 0;
    const current = this.cart.lines().find((line) => line.product.id === product.id);
    if ((current?.quantity || 0) >= available) {
      this.toasts.error(`No hay más stock de ${product.name}. Quedan ${available} unidades.`);
      return;
    }

    this.cart.add(product, this.defaultLot(product));
    this.search.set('');
    this.syncPaidToTotal();
  }

  updateQuantity(index: number, value: string): void {
    this.cart.setQuantity(index, Number(value));
    this.syncPaidToTotal();
  }

  updateDiscount(index: number, value: string): void {
    this.cart.setDiscount(index, Number(value));
    this.syncPaidToTotal();
  }

  removeLine(index: number): void {
    this.cart.remove(index);
    this.syncPaidToTotal();
  }

  selectCurrency(currency: Currency): void {
    if (currency === 'VES' && !this.canChargeVes()) {
      this.toasts.warning(
        'La tasa BCV está desactualizada. Solo se permite cobrar en USD hasta regularizarla.',
      );
      return;
    }
    this.currency.set(currency);
    this.syncPaidToTotal();
  }

  selectPaymentMethod(value: string): void {
    this.paymentMethod.set(value);
  }

  onPaidInput(value: string): void {
    this.paidAmount.set(Number(value));
  }

  fillExactAmount(): void {
    this.paidAmount.set(this.totals().total);
  }

  charge(): void {
    const lines = this.cart.lines();
    if (lines.length === 0) {
      this.toasts.error('Agrega productos antes de cobrar.', 'Escanea un código o busca un producto.');
      return;
    }
    if (!this.canCharge()) {
      this.toasts.error('No se puede facturar hasta actualizar la tasa BCV.');
      return;
    }
    if (this.currency() === 'VES' && !this.canChargeVes()) {
      this.toasts.warning('La tasa BCV está desactualizada. Cobra en USD.');
      return;
    }
    if (this.paidAmount() + 0.001 < this.totals().total) {
      this.toasts.error('El monto pagado es menor al total de la venta.');
      return;
    }

    if (!this.idempotencyKey()) this.idempotencyKey.set(crypto.randomUUID());
    this.submitting.set(true);

    const payload = {
      currency: this.currency(),
      paymentMethod: this.paymentMethod(),
      customerName: 'Consumidor final',
      items: lines.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        discountPercent: line.discountPercent,
        lot: line.lot,
      })),
      payment: {
        amount: this.paidAmount(),
        reference: null,
      },
    };

    this.api
      .post<Sale>('/sales', payload, {
        headers: { 'X-Idempotency-Key': this.idempotencyKey() as string },
      })
      .subscribe({
        next: (sale) => {
          this.lastSale.set(sale);
          this.cart.clear();
          this.checkoutOpen.set(false);
          this.paidAmount.set(0);
          this.idempotencyKey.set(null);
          this.toasts.success(`Venta ${sale.number} registrada correctamente.`);
        },
        error: (error: unknown) => {
          const apiError = toApiError(error);
          this.toasts.error(apiError.userMessage, apiError.suggestion);
        },
        complete: () => this.submitting.set(false),
      });
  }

  downloadInvoice(): void {
    const sale = this.lastSale();
    if (!sale?.invoice?.pdfUrl) return;

    this.api.download(sale.invoice.pdfUrl).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${sale.invoiceNumber}.pdf`;
        anchor.click();
        URL.revokeObjectURL(url);
      },
      error: (error: unknown) => {
        const apiError = toApiError(error);
        this.toasts.error(apiError.userMessage, apiError.suggestion);
      },
    });
  }

  newSale(): void {
    this.lastSale.set(null);
    this.search.set('');
    this.syncPaidToTotal();
  }

  private loadCatalog(): void {
    forkJoin({
      products: this.api.get<Product[]>('/products?limit=100&active=true'),
      rate: this.api.get<RateSnapshot>('/exchange-rates/current'),
    }).subscribe({
      next: ({ products, rate }) => {
        this.products.set(products);
        this.rate.set(rate);
        this.syncPaidToTotal();
      },
      error: (error: unknown) => {
        const apiError = toApiError(error);
        this.toasts.error(apiError.userMessage, apiError.suggestion);
        this.loading.set(false);
      },
      complete: () => this.loading.set(false),
    });
  }

  private applyStockEvent(event: StockEvent): void {
    this.products.update((items) =>
      items.map((product) =>
        product.id === event.productId
          ? {
              ...product,
              stockCurrent: event.available,
              stock: { ...product.stock, available: event.available },
            }
          : product,
      ),
    );

    const lines = this.cart.lines();
    const index = lines.findIndex((line) => line.product.id === event.productId);
    if (index < 0 || lines[index].quantity <= event.available) return;

    if (event.available <= 0) {
      this.cart.remove(index);
    } else {
      this.cart.setQuantity(index, event.available);
    }
    this.syncPaidToTotal();
    this.toasts.warning(`El stock de ${lines[index].product.name} cambió a ${event.available}.`);
  }

  private defaultLot(product: Product): string | null {
    const today = new Date().toISOString().slice(0, 10);
    const batch = product.batches.find(
      (item) => item.quantity > 0 && (!item.expirationDate || item.expirationDate.slice(0, 10) >= today),
    );
    return batch?.lot ?? null;
  }

  private syncPaidToTotal(): void {
    this.paidAmount.set(this.totals().total);
  }
}
