import { create } from 'zustand';
import { Product, ProductVariant, CartItem } from '@event-pos/shared-types';

interface CartState {
  items: CartItem[];
  addItem: (product: Product, variant?: ProductVariant) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  appendNote: (id: string, note: string) => void;
  get total(): number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  addItem: (product, variant) => {
    const cartId = variant ? `${product.id}-${variant.id}` : product.id;
    const existing = get().items.find(i => i.id === cartId);
    
    if (existing) {
      set({ items: get().items.map(i => i.id === cartId ? { ...i, quantity: i.quantity + 1 } : i) });
    } else {
      set({ items: [...get().items, { id: cartId, product, variant, quantity: 1 }] });
    }
  },
  removeItem: (id) => {
    set({ items: get().items.filter(i => i.id !== id) });
  },
  updateQuantity: (id, quantity) => {
    set({ items: get().items.map(i => i.id === id ? { ...i, quantity } : i) });
  },
  clearCart: () => set({ items: [] }),
  appendNote: (id, note) => {
    set({ items: get().items.map(i => {
      if (i.id !== id) return i;
      const v = i.variant ? { ...i.variant, name: i.variant.name + ' - ' + note } : { id: 'note', productId: i.product.id, name: note, priceDelta: 0 };
      return { ...i, variant: v as any };
    })});
  },
  get total() {
    return get().items.reduce((sum, item) => {
      const price = item.product.price + (item.variant?.priceDelta || 0);
      return sum + (price * item.quantity);
    }, 0);
  }
}));
