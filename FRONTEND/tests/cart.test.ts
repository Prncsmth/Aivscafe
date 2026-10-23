import { describe, expect, it } from 'vitest';
import { addToCart, cartTotals, checkPayments, setQuantity, toOfflinePayload, toOnlineRequest, type CartLine } from '@/lib/pos/cart';
import { parsePeso, peso, toPesoInput } from '@/lib/money';

const tea: Omit<CartLine, 'key'> = {
  variantId: 'v1',
  productName: 'Milk Tea',
  variantName: 'Large',
  unitPriceCentavos: 6900,
  modifiers: [{ modifierId: 'm1', name: 'Pearls', priceCentavos: 1000 }],
  quantity: 1,
};

describe('money', () => {
  it('parses peso input without floating point errors', () => {
    expect(parsePeso('49')).toBe(4900);
    expect(parsePeso('49.5')).toBe(4950);
    expect(parsePeso('1,250.75')).toBe(125075);
    expect(parsePeso('0.1')).toBe(10);
    expect(parsePeso('abc')).toBeNull();
    expect(parsePeso('1.234')).toBeNull();
    expect(peso(125075)).toBe('₱1,250.75');
    expect(toPesoInput(4950)).toBe('49.50');
  });
});

describe('cart', () => {
  it('merges identical lines and removes at zero', () => {
    let lines = addToCart([], tea);
    lines = addToCart(lines, tea);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(2);
    lines = addToCart(lines, { ...tea, modifiers: [] });
    expect(lines).toHaveLength(2);
    lines = setQuantity(lines, lines[0].key, 0);
    expect(lines).toHaveLength(1);
  });

  it('computes totals in centavos', () => {
    const lines = addToCart(addToCart([], tea), tea);
    expect(cartTotals(lines, 1000, 3000)).toEqual({ subtotalCentavos: 15800, discountCentavos: 1000, deliveryFeeCentavos: 3000, totalCentavos: 17800 });
  });

  it('validates payments and computes change', () => {
    expect(checkPayments([{ method: 'CASH', amountCentavos: 7900, tenderedCentavos: 10000 }], 7900)).toEqual({ changeCentavos: 2100, paidCentavos: 7900 });
    expect(checkPayments([{ method: 'CASH', amountCentavos: 7900, tenderedCentavos: 5000 }], 7900).error).toBeTruthy();
    expect(checkPayments([{ method: 'GCASH', amountCentavos: 9000 }], 7900).error).toBeTruthy();
  });

  it('builds consistent online and offline payloads', () => {
    const lines = addToCart([], tea);
    const d = { clientId: 'c1', type: 'WALK_IN' as const, lines, discountCentavos: 0, deliveryFeeCentavos: 5000, payments: [] };
    // Walk-in orders never carry a delivery fee (online or offline)
    expect(toOnlineRequest(d).expectedTotalCentavos).toBe(7900);
    const delivery = { customerName: 'Ana', contactNumber: '09171234567', address: 'Cordova', areaId: 'a1', areaName: 'Cordova' };
    expect(toOnlineRequest({ ...d, type: 'DELIVERY', delivery }).expectedTotalCentavos).toBe(12900);
    const off = toOfflinePayload(d, { tempReference: 'OFF-1', catalogVersion: 3, shiftId: null, status: 'PENDING' });
    expect(off.deliveryFeeCentavos).toBe(0);
    expect(off.totalCentavos).toBe(7900);
    expect(off.subtotalCentavos).toBe(7900);
  });
});
