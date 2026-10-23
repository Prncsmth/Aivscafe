// Shapes returned by the Express API. Money is always integer centavos.

export type Role = 'OWNER' | 'CASHIER';
export type OrderType = 'WALK_IN' | 'DELIVERY' | 'MESSENGER';
export type OrderStatus =
  | 'PENDING'
  | 'PREPARING'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'VOIDED';
export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
export type PaymentMethod = 'CASH' | 'GCASH';
export type BaseUnit = 'G' | 'ML' | 'PCS';
export type Unit = BaseUnit | 'KG' | 'L';

export interface User {
  id: string;
  name: string;
  username: string;
  role: Role;
  isActive?: boolean;
}

export interface CatalogVariant {
  id: string;
  name: string;
  priceCentavos: number;
  isAvailable: boolean;
  stock?: { level: 'OK' | 'LOW' | 'OUT' | 'NO_RECIPE'; maxServings: number | null; limitedBy: string | null };
}
export interface CatalogModifier {
  id: string;
  name: string;
  priceCentavos: number;
}
export interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  isAvailable: boolean;
  variants: CatalogVariant[];
  modifiers: CatalogModifier[];
}
export interface CatalogCategory {
  id: string;
  name: string;
  products: CatalogProduct[];
}
export interface DeliveryArea {
  id: string;
  name: string;
  feeCentavos: number;
  isActive?: boolean;
}
export interface Catalog {
  version: number;
  generatedAt: string;
  categories: CatalogCategory[];
  deliveryAreas: DeliveryArea[];
}

export interface Settings {
  insufficientStockPolicy: 'BLOCK' | 'ALLOW';
  maxCashierDiscountPercent: number;
  cashVarianceReviewThresholdCentavos: number;
  orderPrefix: string;
  expiryWarningDays: number;
  shopName: string;
  autoCompleteWalkIn: boolean;
  /** Walk-in only shop: no order queue, delivery or Messenger orders. */
  walkInOnly: boolean;
}

export interface Payment {
  id: string;
  kind: 'PAYMENT' | 'REFUND';
  method: PaymentMethod;
  amountCentavos: number;
  tenderedCentavos: number | null;
  changeCentavos: number | null;
  reference: string | null;
  verification: 'VERIFIED' | 'UNVERIFIED';
  recordedOffline: boolean;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  productName: string;
  variantName: string;
  unitPriceCentavos: number;
  modifiersCentavos: number;
  quantity: number;
  lineTotalCentavos: number;
  notes: string | null;
  modifiers: { id: string; name: string; priceCentavos: number }[];
}

export interface Order {
  id: string;
  clientId: string;
  reference: string;
  tempReference: string | null;
  type: OrderType;
  status: OrderStatus;
  source: 'ONLINE' | 'OFFLINE_SYNC';
  customerName: string | null;
  notes: string | null;
  subtotalCentavos: number;
  discountCentavos: number;
  discountReason: string | null;
  deliveryFeeCentavos: number;
  totalCentavos: number;
  paidCentavos: number;
  refundedCentavos: number;
  paymentStatus: PaymentStatus;
  createdAt: string;
  cancelReason: string | null;
  items: OrderItem[];
  payments: Payment[];
  delivery: {
    customerName: string;
    contactNumber: string;
    address: string;
    areaName: string;
    deliveryFeeCentavos: number;
    instructions: string | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
  } | null;
  conflicts: { id: string; type: string; status: string }[];
  cashier: { id: string; name: string };
  statusLog?: { id: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string | null; createdAt: string }[];
}

export interface ShiftSummary {
  shift: {
    id: string;
    userId: string;
    status: 'OPEN' | 'CLOSED';
    openedAt: string;
    closedAt: string | null;
    startingCashCentavos: number;
    countedCashCentavos: number | null;
    cashVarianceCentavos: number | null;
    reportedGcashCentavos: number | null;
    reviewStatus: 'NOT_REQUIRED' | 'PENDING_REVIEW' | 'REVIEWED';
    reviewNote: string | null;
    notes: string | null;
    user?: { id: string; name: string };
  };
  cashPaymentsCentavos: number;
  cashRefundsCentavos: number;
  cashInCentavos: number;
  cashOutCentavos: number;
  expectedCashCentavos: number;
  gcashPaymentsCentavos: number;
  gcashRefundsCentavos: number;
  gcashUnverifiedCentavos: number;
  expectedGcashCentavos: number;
  totalSalesCentavos: number;
  orderCount: number;
  cancelledOrVoidedCount: number;
  openOrderCount: number;
}

export interface Ingredient {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  stockQty: string;
  lowStockThreshold: string;
  isActive: boolean;
  level: 'OK' | 'LOW' | 'OUT';
  avgUnitCost?: string;
}
