/**
 * Money is stored as integer cents everywhere in the app.
 * Floating point euros drift once you start multiplying by split shares,
 * so the only place a fractional number exists is the parse/format boundary.
 */

const CENTS_PER_UNIT = 100;

/** Parses user input ("12,50", "12.5", "1 234,56") into cents. Returns null when unparseable. */
export function parseAmountToCents(input: string): number | null {
  const normalised = input.trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!normalised || !/^-?\d*\.?\d*$/.test(normalised)) {
    return null;
  }
  const value = Number(normalised);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * CENTS_PER_UNIT);
}

/** Cents -> plain decimal string for prefilling an <input>, e.g. 1250 -> "12.50". */
export function centsToInputValue(cents: number): string {
  return (cents / CENTS_PER_UNIT).toFixed(2);
}

export interface MoneyFormatOptions {
  readonly locale?: string;
  readonly currency?: string;
  /** Force a leading + on positive values. */
  readonly signed?: boolean;
}

export function formatCents(cents: number, options: MoneyFormatOptions = {}): string {
  const { locale = 'fi-FI', currency = 'EUR', signed = false } = options;
  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(cents / CENTS_PER_UNIT);
  // Intl separates groups and the currency symbol with (narrow) non-breaking
  // spaces; normalise them so the app controls spacing consistently.
  return formatted.replace(/[\u00a0\u202f]/g, ' ');
}

/** Applies a share (0..1) to a positive amount, rounding to whole cents. */
export function applyShare(amountCents: number, share: number): number {
  return Math.round(Math.abs(amountCents) * share);
}
