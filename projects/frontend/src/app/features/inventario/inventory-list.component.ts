import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { toApiError } from '../../core/errors/api-error';
import { Product } from '../../core/models/product.model';
import { ApiService } from '../../core/services/api.service';
import { SocketService, StockEvent } from '../../core/services/socket.service';
import { TokenService } from '../../core/services/token.service';
import { formatMoney } from '../../shared/money';

export type InventorySort = 'name' | 'sku' | 'stock';

/** Un producto está en stock mínimo cuando lo disponible es menor o igual al umbral. */
export function isLowStock(product: Product): boolean {
  const available = Number(product.stock?.available ?? product.stockCurrent ?? 0);
  const minimum = Number(product.stock?.minimum ?? product.stockMinimum ?? 0);
  return available <= minimum;
}

export function filterProducts(products: Product[], term: string): Product[] {
  const query = term.trim().toLowerCase();
  if (!query) return products;

  return products.filter(
    (product) =>
      product.name.toLowerCase().includes(query) ||
      product.sku.toLowerCase().includes(query) ||
      (product.barcode || '').includes(query) ||
      product.category.toLowerCase().includes(query),
  );
}

export function sortProducts(
  products: Product[],
  key: InventorySort,
  direction: 'asc' | 'desc',
): Product[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...products].sort((left, right) => {
    let comparison = 0;
    if (key === 'stock') {
      comparison =
        Number(left.stock?.available ?? left.stockCurrent ?? 0) -
        Number(right.stock?.available ?? right.stockCurrent ?? 0);
    } else if (key === 'sku') {
      comparison = left.sku.localeCompare(right.sku);
    } else {
      comparison = left.name.localeCompare(right.name);
    }
    return comparison * factor;
  });
}

@Component({
  selector: 'app-inventory-list',
  standalone: true,
  templateUrl: './inventory-list.component.html',
  styleUrl: './inventory-list.component.scss',
})
export class InventoryListComponent {
  private readonly api = inject(ApiService);
  private readonly tokens = inject(TokenService);
  private readonly socket = inject(SocketService);

  readonly formatMoney = formatMoney;
  readonly isLowStock = isLowStock;

  readonly products = signal<Product[]>([]);
  readonly search = signal('');
  readonly sortKey = signal<InventorySort>('name');
  readonly sortDirection = signal<'asc' | 'desc'>('asc');
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly lowStockCount = computed(() => this.products().filter(isLowStock).length);
  readonly visibleProducts = computed(() =>
    sortProducts(filterProducts(this.products(), this.search()), this.sortKey(), this.sortDirection()),
  );

  constructor() {
    if (this.tokens.isAuthenticated()) this.socket.connect();
    this.load();

    this.socket.stockUpdates.pipe(takeUntilDestroyed()).subscribe((event) => this.applyStockEvent(event));
  }

  onSearch(value: string): void {
    this.search.set(value);
  }

  sortBy(key: InventorySort): void {
    if (this.sortKey() === key) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      return;
    }
    this.sortKey.set(key);
    this.sortDirection.set('asc');
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.api.get<Product[]>('/products?limit=200&active=true').subscribe({
      next: (products) => this.products.set(products),
      error: (error: unknown) => {
        const apiError = toApiError(error);
        this.errorMessage.set(apiError.userMessage);
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
  }
}
