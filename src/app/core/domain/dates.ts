/**
 * Dates are handled as plain ISO day strings (YYYY-MM-DD) — no timezone surprises.
 *
 * Date labels follow the UI language (English), while amounts follow the
 * user's number-format setting; the two are deliberately independent.
 */

export const UI_LOCALE = 'en-GB';

export type IsoDate = string;
/** YYYY-MM */
export type MonthKey = string;

export function todayIso(): IsoDate {
  const now = new Date();
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function toIsoDate(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function monthKeyOf(date: IsoDate): MonthKey {
  return date.slice(0, 7);
}

export function currentMonthKey(): MonthKey {
  return monthKeyOf(todayIso());
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [year, monthNumber] = splitMonthKey(month);
  const zeroBased = (year * 12 + (monthNumber - 1)) + delta;
  return `${pad(Math.floor(zeroBased / 12), 4)}-${pad((zeroBased % 12) + 1, 2)}`;
}

export function splitMonthKey(month: MonthKey): [year: number, month: number] {
  const [year, monthNumber] = month.split('-');
  return [Number(year), Number(monthNumber)];
}

export function monthLabel(month: MonthKey, locale = UI_LOCALE): string {
  const [year, monthNumber] = splitMonthKey(month);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

export function dayLabel(date: IsoDate, locale = UI_LOCALE): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

export function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}
