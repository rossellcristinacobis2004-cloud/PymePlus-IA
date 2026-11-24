import { Injectable, computed, signal } from '@angular/core';

import { Product } from '../../core/models/product.model';
import { CartLine } from '../../shared/cart';

@Injectable()
export class CartStore {
  private readonly linesSignal = signal<CartLine[]>([]);

  readonly lines = this.linesSignal.asReadonly();
  readonly itemCount = computed(() => this.linesSignal().reduce((total, line) => total + line.quantity, 0));
  readonly isEmpty = computed(() => this.linesSignal().length === 0);

  add(product: Product, lot: string | null = null): void {
    this.linesSignal.update((lines) => {
      const index = lines.findIndex((line) => line.product.id === product.id && line.lot === lot);
      if (index >= 0) {
        return lines.map((line, position) =>
          position === index ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...lines, { product, quantity: 1, discountPercent: 0, lot }];
    });
  }

  remove(index: number): void {
    this.linesSignal.update((lines) => lines.filter((_line, position) => position !== index));
  }

  setQuantity(index: number, quantity: number): void {
    if (!Number.isFinite(quantity) || quantity < 1) return;
    this.linesSignal.update((lines) =>
      lines.map((line, position) => (position === index ? { ...line, quantity: Math.floor(quantity) } : line)),
    );
  }

  setDiscount(index: number, percent: number): void {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
    this.linesSignal.update((lines) =>
      lines.map((line, position) => (position === index ? { ...line, discountPercent: percent } : line)),
    );
  }

  clear(): void {
    this.linesSignal.set([]);
  }
}
