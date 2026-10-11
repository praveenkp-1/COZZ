export interface User {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER" | "ADMIN";
  verified: boolean;
}
export interface Session {
  user: User | null;
  csrfToken: string;
}
export interface ProductImage {
  url: string;
  alt: string;
}
export interface Variant {
  id: string;
  sku: string;
  size: string;
  color: string;
  price: number | null;
  inventory: { stock: number; reserved: number } | null;
}
export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}
export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  gender: string;
  price: number;
  compareAtPrice: number | null;
  active: boolean;
  featured: boolean;
  categoryId: string;
  category: Category;
  images: ProductImage[];
  variants: Variant[];
  salesCount: number;
  rating?: number | null;
  reviewCount?: number;
  reviews?: {
    id: string;
    rating: number;
    title: string;
    body: string;
    user: { name: string };
    createdAt: string;
  }[];
}
export interface ProductList {
  items: Product[];
  total: number;
  page: number;
  pages: number;
}
export interface Shipping {
  id: string;
  name: string;
  description: string;
  fee: number;
  freeAbove: number;
  active: boolean;
}
export interface Settings {
  id: string;
  storeName: string;
  supportEmail: string;
  announcement: string;
  taxBasisPoints: number;
  privacy: string;
  shippingPolicy: string;
  returnsPolicy: string;
  terms: string;
  policiesPublished: boolean;
}
export interface Store {
  settings: Settings;
  categories: Category[];
  shippingMethods: Shipping[];
  collections: {
    id: string;
    name: string;
    slug: string;
    description: string;
    image: string;
    active: boolean;
  }[];
  banners: {
    id: string;
    title: string;
    description: string;
    image: string;
    href: string;
    active: boolean;
  }[];
  sizes: string[];
  colors: string[];
  paymentEnabled: boolean;
  paymentMode: string;
}
export interface CartItem {
  id: string;
  variantId: string;
  quantity: number;
  size: string;
  color: string;
  stock: number;
  available: boolean;
  unitPrice: number;
  productId: string;
  name: string;
  slug: string;
  image: string;
}
export interface Cart {
  items: CartItem[];
  subtotal: number;
}
export interface Quote {
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
}
export interface Address {
  id?: string;
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  country: "LK";
}
export interface Order {
  id: string;
  number: string;
  status: string;
  email: string;
  address: Address;
  billingAddress: Address;
  items: {
    id: string;
    productName: string;
    productSlug: string;
    image: string;
    size: string;
    color: string;
    quantity: number;
    unitPrice: number;
    variantId: string;
  }[];
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
  createdAt: string;
  expiresAt: string | null;
  tracking: string;
  notes: string;
  payment: {
    provider: "COD" | "PAYHERE";
    status: string;
    collectedAt: string | null;
    collectedById: string | null;
    collectedBy?: { id: string; name: string } | null;
    providerPaymentId: string | null;
    refundReference: string | null;
  } | null;
  shippingName: string;
}
export interface PaymentForm {
  action: string;
  fields: Record<string, string>;
}
