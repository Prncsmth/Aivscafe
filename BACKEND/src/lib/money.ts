/**
 * Money helpers. All amounts are integer centavos — never floats.
 * PHP 49.00 => 4900.
 */
export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Percentage of an amount, rounded half-up to the nearest centavo. */
export function percentOf(amountCentavos: number, percent: number): number {
  return Math.round((amountCentavos * percent) / 100);
}

export function formatPHP(centavos: number): string {
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const pesos = Math.floor(abs / 100).toLocaleString('en-PH');
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}₱${pesos}.${cents}`;
}
