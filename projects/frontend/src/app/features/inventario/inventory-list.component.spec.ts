import { filterProducts, isLowStock, sortProducts } from './inventory-list.component';
import { Product } from '../../core/models/product.model';

function product(id: string, name: string, sku: string, available: number, minimum: number, category = 'General'): Product {
  return {
    id,
    sku,
    barcode: null,
    name,
    description: '',
    category,
    priceUSD: 10,
    stockCurrent: available,
    stockMinimum: minimum,
    isActive: true,
    pricing: {
      priceIncludesTax: false,
      tax: { type: 'IVA_GENERAL', rate: 0.16 },
      mode: 'AUTO_BCV',
      price: {
        USD: { amount: 10, currency: 'USD', rateUsed: null },
        VES: { amount: 360, currency: 'VES', rateUsed: null },
      },
    },
    stock: { available, reserved: 0, minimum, unit: 'UN', status: 'NORMAL' },
    batches: [],
  };
}

const products = [
  product('1', 'Aceite', 'ALI-001', 3, 5, 'Abarrotes'),
  product('2', 'Agua', 'BEB-002', 20, 4, 'Bebidas'),
  product('3', 'Martillo', 'FER-003', 8, 8, 'Ferretería'),
];

describe('inventario helpers', () => {
  it('detecta stock mínimo con disponible menor o igual al umbral', () => {
    expect(isLowStock(products[0])).toBe(true);
    expect(isLowStock(products[1])).toBe(false);
    expect(isLowStock(products[2])).toBe(true);
  });

  it('filtra por nombre, SKU y categoría', () => {
    expect(filterProducts(products, 'agua').map((item) => item.id)).toEqual(['2']);
    expect(filterProducts(products, 'fer-').map((item) => item.id)).toEqual(['3']);
    expect(filterProducts(products, 'Abarrotes').map((item) => item.id)).toEqual(['1']);
    expect(filterProducts(products, '   ')).toHaveLength(3);
  });

  it('ordena por nombre, SKU y stock en ambos sentidos', () => {
    expect(sortProducts(products, 'name', 'asc').map((item) => item.name)).toEqual([
      'Aceite',
      'Agua',
      'Martillo',
    ]);
    expect(sortProducts(products, 'stock', 'desc').map((item) => item.id)).toEqual(['2', '3', '1']);
    expect(sortProducts(products, 'sku', 'asc')[0].sku).toBe('ALI-001');
  });

  it('no muta el arreglo original al ordenar', () => {
    const original = products.map((item) => item.id);
    sortProducts(products, 'name', 'desc');
    expect(products.map((item) => item.id)).toEqual(original);
  });
});
