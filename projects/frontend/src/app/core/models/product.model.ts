import { Money } from './money.model';
import { RateSnapshot } from './rate.model';

export interface ProductBatch {
  lot: string;
  quantity: number;
  expirationDate: string | null;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string;
  category: string;
  priceUSD: number;
  stockCurrent: number;
  stockMinimum: number;
  isActive: boolean;
  pricing: {
    priceIncludesTax: boolean;
    tax: { type: string; rate: number };
    mode: string;
    price: { USD: Money; VES: Money };
  };
  stock: {
    available: number;
    reserved: number;
    minimum: number;
    unit: string;
    status: string;
  };
  batches: ProductBatch[];
}

export type { Money, RateSnapshot };
