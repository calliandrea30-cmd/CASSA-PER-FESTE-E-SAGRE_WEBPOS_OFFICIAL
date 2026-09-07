export interface Event {
    id: string;
    name: string;
    date: string;
    active: boolean;
}
export interface Station {
    id: string;
    eventId: string;
    name: string;
    status: string;
}
export interface Category {
    id: string;
    name: string;
    orderIndex: number;
}
export interface ProductVariant {
    id: string;
    productId: string;
    name: string;
    priceDelta: number;
}
export interface Product {
    id: string;
    categoryId: string;
    name: string;
    price: number;
    available: boolean;
    stock?: number;
    imageUrl?: string;
    department?: string;
    variants?: ProductVariant[];
    isCombo?: boolean;
    comboItems?: any[];
}
export interface CartItem {
    id: string;
    product: Product;
    variant?: ProductVariant;
    quantity: number;
}
