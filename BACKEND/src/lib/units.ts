import { Prisma, Unit } from '@prisma/client';

/** Base units that ingredients are stored in. */
export const BASE_UNITS: Unit[] = ['G', 'ML', 'PCS'];

const CONVERSIONS: Record<Unit, { base: Unit; factor: number }> = {
  G: { base: 'G', factor: 1 },
  KG: { base: 'G', factor: 1000 },
  ML: { base: 'ML', factor: 1 },
  L: { base: 'ML', factor: 1000 },
  PCS: { base: 'PCS', factor: 1 },
};

export function isBaseUnit(u: Unit): boolean {
  return BASE_UNITS.includes(u);
}

export function areCompatible(from: Unit, base: Unit): boolean {
  return CONVERSIONS[from].base === base;
}

/**
 * Convert a quantity entered in `from` units into the ingredient's `base` unit.
 * Throws for incompatible units (e.g. KG -> ML, L -> PCS).
 */
export function toBaseUnit(quantity: Prisma.Decimal | number | string, from: Unit, base: Unit): Prisma.Decimal {
  if (!isBaseUnit(base)) throw new Error(`${base} is not a base unit`);
  if (!areCompatible(from, base)) {
    throw new Error(`Cannot convert ${from} to ${base}: incompatible units`);
  }
  return new Prisma.Decimal(quantity).mul(CONVERSIONS[from].factor);
}
