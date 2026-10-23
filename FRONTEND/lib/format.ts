import type { OrderStatus, OrderType, PaymentStatus } from './types';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  PREPARING: 'Preparing',
  READY: 'Ready',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  VOIDED: 'Voided',
};

export const STATUS_TONE: Record<OrderStatus, 'pink' | 'ok' | 'warn' | 'bad' | 'muted' | 'lilac'> = {
  PENDING: 'warn',
  PREPARING: 'lilac',
  READY: 'pink',
  OUT_FOR_DELIVERY: 'lilac',
  DELIVERED: 'ok',
  COMPLETED: 'ok',
  CANCELLED: 'bad',
  VOIDED: 'bad',
};

export const TYPE_LABEL: Record<OrderType, string> = { WALK_IN: 'Walk-in', DELIVERY: 'Delivery', MESSENGER: 'Messenger' };

export const PAY_LABEL: Record<PaymentStatus, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
};
export const PAY_TONE: Record<PaymentStatus, 'ok' | 'warn' | 'bad' | 'muted'> = {
  UNPAID: 'bad',
  PARTIALLY_PAID: 'warn',
  PAID: 'ok',
  PARTIALLY_REFUNDED: 'warn',
  REFUNDED: 'muted',
};

/** What pressing the next-step button does, in plain words (the button names the action, not the status). */
export function actionLabel(next: OrderStatus, isDelivery: boolean): string {
  switch (next) {
    case 'PREPARING':
      return 'Start preparing';
    case 'READY':
      return 'Mark as ready';
    case 'OUT_FOR_DELIVERY':
      return 'Send out for delivery';
    case 'DELIVERED':
      return 'Mark as delivered';
    case 'COMPLETED':
      return isDelivery ? 'Mark as delivered' : 'Give to customer';
    default:
      return STATUS_LABEL[next];
  }
}

/** The steps an order goes through, for progress displays. */
export function flowSteps(isDelivery: boolean): OrderStatus[] {
  return isDelivery ? ['PENDING', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] : ['PENDING', 'PREPARING', 'READY', 'COMPLETED'];
}

/** Whole minutes since a timestamp. */
export function minutesSince(d: string | number): number {
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
}

/** Mirrors the backend workflow. */
export function nextStatus(status: OrderStatus, isDelivery: boolean): OrderStatus | null {
  const flow: OrderStatus[] = isDelivery
    ? ['PENDING', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']
    : ['PENDING', 'PREPARING', 'READY', 'COMPLETED'];
  const i = flow.indexOf(status);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
}

const TZ = 'Asia/Manila';
export const fmtDateTime = (d: string | number | Date) =>
  new Date(d).toLocaleString('en-PH', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const fmtTime = (d: string | number | Date) => new Date(d).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
export const fmtDate = (d: string | number | Date) => new Date(d).toLocaleDateString('en-PH', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });

/** YYYY-MM-DD in Manila time. */
export function manilaDay(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}
export function addDays(day: string, n: number): string {
  const [y, m, dd] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}

export function minutesAgo(d: string | number): string {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m ago` : fmtDateTime(d);
}

export function qty(value: string | number, unit: string): string {
  const n = Number(value);
  const shown = Number.isInteger(n) ? n.toLocaleString('en-PH') : n.toLocaleString('en-PH', { maximumFractionDigits: 3 });
  return `${shown} ${unit.toLowerCase() === 'pcs' ? 'pcs' : unit.toLowerCase()}`;
}
