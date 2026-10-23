/** Money is integer centavos everywhere. These helpers never use floating-point math on amounts. */

export function peso(centavos: number): string {
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(centavos));
  const whole = Math.floor(abs / 100).toLocaleString('en-PH');
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}₱${whole}.${cents}`;
}

/**
 * Parse what a cashier types ("49", "49.5", "1,250.75") into centavos using string math.
 * Returns null for invalid input.
 */
export function parsePeso(input: string): number | null {
  const s = input.replace(/[₱,\s]/g, '');
  if (!s) return null;
  const m = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** Centavos -> editable string ("49.00" -> "49", "49.50" -> "49.50"). */
export function toPesoInput(centavos: number): string {
  if (centavos % 100 === 0) return String(centavos / 100);
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}

export function percentOf(amountCentavos: number, percent: number): number {
  return Math.round((amountCentavos * percent) / 100);
}
