import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { toBaseUnit } from '../src/lib/units';
import {
  computeTotals,
  expectedCash,
  nextStatus,
  paymentStatusFor,
  validatePayments,
} from '../src/services/order.rules';
import { businessDay, startOfBusinessDay } from '../src/lib/time';

describe('unit conversion', () => {
  it('converts kilograms to grams and litres to millilitres', () => {
    expect(toBaseUnit('2.5', 'KG', 'G').toString()).toBe('2500');
    expect(toBaseUnit(1.25, 'L', 'ML').toString()).toBe('1250');
    expect(toBaseUnit(12, 'PCS', 'PCS').toString()).toBe('12');
  });

  it('rejects incompatible units', () => {
    expect(() => toBaseUnit(1, 'KG', 'ML')).toThrow(/incompatible/);
    expect(() => toBaseUnit(1, 'L', 'PCS')).toThrow(/incompatible/);
    expect(() => toBaseUnit(1, 'G', 'KG' as never)).toThrow(/not a base unit/);
  });

  it('keeps decimal precision (no float drift)', () => {
    expect(new Prisma.Decimal('0.1').add('0.2').toString()).toBe('0.3');
  });
});

describe('order totals (integer centavos)', () => {
  it('sums lines with modifiers, discount and delivery fee', () => {
    const t = computeTotals(
      [
        { unitPriceCentavos: 4900, modifiersCentavos: 1000, quantity: 2 },
        { unitPriceCentavos: 6900, modifiersCentavos: 0, quantity: 1 },
      ],
      500,
      3000,
    );
    expect(t).toEqual({ subtotalCentavos: 18700, discountCentavos: 500, totalCentavos: 21200 });
  });

  it('caps discount at the subtotal', () => {
    expect(computeTotals([{ unitPriceCentavos: 1000, modifiersCentavos: 0, quantity: 1 }], 5000, 0).discountCentavos).toBe(1000);
  });
});

describe('payments', () => {
  it('computes cash change and allows split payments', () => {
    const r = validatePayments(
      [
        { method: 'GCASH', amountCentavos: 5000 },
        { method: 'CASH', amountCentavos: 4900, tenderedCentavos: 10000 },
      ],
      9900,
    );
    expect(r.error).toBeUndefined();
    expect(r.changes).toEqual([0, 5100]);
  });

  it('rejects overpayment, short cash and GCash change', () => {
    expect(validatePayments([{ method: 'CASH', amountCentavos: 6000 }], 5000).error).toMatch(/exceed/);
    expect(validatePayments([{ method: 'CASH', amountCentavos: 5000, tenderedCentavos: 4000 }], 5000).error).toMatch(/less/);
    expect(validatePayments([{ method: 'GCASH', amountCentavos: 5000, tenderedCentavos: 6000 }], 5000).error).toMatch(/change/);
  });

  it('derives payment status', () => {
    expect(paymentStatusFor(5000, 0, 0)).toBe('UNPAID');
    expect(paymentStatusFor(5000, 2000, 0)).toBe('PARTIALLY_PAID');
    expect(paymentStatusFor(5000, 5000, 0)).toBe('PAID');
    expect(paymentStatusFor(5000, 5000, 5000)).toBe('REFUNDED');
    expect(paymentStatusFor(5000, 5000, 1000)).toBe('PARTIALLY_REFUNDED');
  });
});

describe('order workflow', () => {
  it('follows pickup and delivery flows one step at a time', () => {
    expect(nextStatus('PENDING', false)).toBe('PREPARING');
    expect(nextStatus('READY', false)).toBe('COMPLETED');
    expect(nextStatus('READY', true)).toBe('OUT_FOR_DELIVERY');
    expect(nextStatus('OUT_FOR_DELIVERY', true)).toBe('DELIVERED');
    expect(nextStatus('COMPLETED', false)).toBeNull();
    expect(nextStatus('CANCELLED', false)).toBeNull();
  });
});

describe('expected cash', () => {
  it('counts only physical cash', () => {
    expect(expectedCash({ startingCash: 100000, cashPayments: 25000, cashRefunds: 4900, cashIn: 5000, cashOut: 20000 })).toBe(105100);
  });
});

describe('business timezone', () => {
  it('uses Asia/Manila days', () => {
    // 2025-10-22 17:30 UTC is 2025-10-23 01:30 in Manila
    expect(businessDay(new Date('2025-10-22T17:30:00Z'))).toBe('2025-10-23');
    expect(startOfBusinessDay('2025-10-23').toISOString()).toBe('2025-10-22T16:00:00.000Z');
  });
});
