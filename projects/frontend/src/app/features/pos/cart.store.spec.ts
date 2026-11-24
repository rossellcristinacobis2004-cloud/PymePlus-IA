import { CartStore } from './cart.store';
import { Product } from '../../core/models/product.model';

const product = {
  id: 'prod_1',
  sku: 'BOD-1',
  barcode: null,
  name: 'Aceite',
  description: '',
  category: 'Abarrotes',
  priceUSD: 6.5,
  stockCurrent: 5,
  stockMinimum: 1,
  isActive: true,
  pricing: {
    priceIncludesTax: false,
    tax: { type: 'IVA_GENERAL', rate: 0.16 },
    mode: 'AUTO_BCV',
    price: {
      USD: { amount: 6.5, currency: 'USD' as const, rateUsed: null },
      VES: { amount: 234, currency: 'VES' as const, rateUsed: null },
    },
  },
  stock: { available: 5, reserved: 0, minimum: 1, unit: 'UN', status: 'NORMAL' },
  batches: [],
} as Product;

describe('CartStore', () => {
  it('agrupa el mismo producto y lote en una sola línea', () => {
    const cart = new CartStore();
    cart.add(product, 'LOTE-1');
    cart.add(product, 'LOTE-1');

    expect(cart.lines().length).toBe(1);
    expect(cart.lines()[0].quantity).toBe(2);
    expect(cart.itemCount()).toBe(2);
  });

  it('separa lotes distintos y permite editar cantidad y descuento', () => {
    const cart = new CartStore();
    cart.add(product, 'LOTE-1');
    cart.add(product, 'LOTE-2');
    cart.setQuantity(1, 3);
    cart.setDiscount(1, 15);

    expect(cart.lines().length).toBe(2);
    expect(cart.lines()[1].quantity).toBe(3);
    expect(cart.lines()[1].discountPercent).toBe(15);
  });

  it('elimina líneas y limpia el carrito', () => {
    const cart = new CartStore();
    cart.add(product);
    cart.add({ ...product, id: 'prod_2' });
    cart.remove(0);

    expect(cart.lines().length).toBe(1);
    expect(cart.isEmpty()).toBe(false);

    cart.clear();
    expect(cart.isEmpty()).toBe(true);
  });
});
