import Dexie, { Table } from 'dexie';

export interface LocalCategory {
  id: string;
  eventId: string;
  name: string;
  orderIndex: number;
  quickNotes?: string | null;
}

export interface LocalProduct {
  id: string;
  eventId: string;
  categoryId: string;
  name: string;
  price: number;
  stock: number;
  available: boolean;
  popularity: number;
  variants: any[];
  isCombo: boolean;
  comboItems?: any[];
}

export interface QueuedOrder {
  id?: number;
  eventId: string;
  stationId: string;
  userId: string;
  items: any[];
  paymentType: string;
  customerName?: string;
  discount: number;
  status: string;
  createdAt: string;
  payloadToPrint: any; // Saves the prepared payload for local printing/reference
}

export class PosDB extends Dexie {
  categories!: Table<LocalCategory, string>;
  products!: Table<LocalProduct, string>;
  ordersQueue!: Table<QueuedOrder, number>;

  constructor() {
    super('PosOfflineDB');
    this.version(1).stores({
      categories: 'id, eventId',
      products: 'id, eventId, categoryId',
      ordersQueue: '++id, eventId'
    });
  }
}

export const db = new PosDB();
