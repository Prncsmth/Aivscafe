import { env } from '../config/env';

/** Returns YYYY-MM-DD for the instant in the business timezone (Asia/Manila by default). */
export function businessDay(date: Date = new Date(), timeZone = env.BUSINESS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Hour of day (0-23) in the business timezone. */
export function businessHour(date: Date, timeZone = env.BUSINESS_TIMEZONE): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date);
  return Number(h);
}

/** Offset (minutes) of the business timezone from UTC at a given instant. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const local = new Date(date.toLocaleString('en-US', { timeZone }));
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local.getTime() - utc.getTime()) / 60000);
}

/** UTC instant of 00:00 local business time on the given YYYY-MM-DD. */
export function startOfBusinessDay(day: string, timeZone = env.BUSINESS_TIMEZONE): Date {
  const [y, m, d] = day.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offset = tzOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60000);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Inclusive business-day range => { gte, lt } UTC instants for Prisma filters. */
export function businessRange(fromDay: string, toDay: string): { gte: Date; lt: Date } {
  return { gte: startOfBusinessDay(fromDay), lt: startOfBusinessDay(addDays(toDay, 1)) };
}
