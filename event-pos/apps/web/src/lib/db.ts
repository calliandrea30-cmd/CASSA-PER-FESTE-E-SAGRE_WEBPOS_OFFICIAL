import Dexie, { Table } from 'dexie';
import { Product } from '@event-pos/shared-types';

export interface OfflineOrder {
  id: string; // temp uuid
  payload: any;
  createdAt: number;
}

export class POSDatabase extends Dexie {
  products!: Table<Product, string>;
  offlineOrders!: Table<OfflineOrder, string>;

  constructor() {
    super('EventPOS_DB');
    this.version(1).stores({
      products: 'id, categoryId',
      offlineOrders: 'id, createdAt'
    });
  }
}

export const db = new POSDatabase();
