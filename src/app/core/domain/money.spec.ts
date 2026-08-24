import { describe, expect, it } from 'vitest';
import { applyShare, centsToInputValue, formatCents, parseAmountToCents } from './money';

describe('parseAmountToCents', () => {
  it('accepts both decimal separators', () => {
    expect(parseAmountToCents('12.50')).toBe(1_250);
    expect(parseAmountToCents('12,50')).toBe(1_250);
  });

  it('accepts grouped and padded input', () => {
    expect(parseAmountToCents(' 1 234,56 ')).toBe(123_456);
    expect(parseAmountToCents('1 234,56')).toBe(123_456);
  });

  it('rounds sub-cent input', () => {
    expect(parseAmountToCents('0.005')).toBe(1);
    expect(parseAmountToCents('19,999')).toBe(2_000);
  });

  it('rejects anything that is not a number', () => {
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('12,50,3')).toBeNull();
  });
});

describe('formatCents', () => {
  it('formats euros the Finnish way without non-breaking spaces', () => {
    expect(formatCents(123_456)).toBe('1 234,56 €');
  });

  it('adds an explicit plus only when asked', () => {
    expect(formatCents(4_000, { signed: true })).toBe('+40,00 €');
    expect(formatCents(4_000)).toBe('40,00 €');
    // fi-FI uses the typographic minus sign (U+2212), not a hyphen.
    expect(formatCents(-4_000, { signed: true })).toBe('\u221240,00 €');
  });

  it('honours other locales and currencies', () => {
    expect(formatCents(123_456, { locale: 'en-GB', currency: 'GBP' })).toBe('£1,234.56');
  });
});

describe('applyShare', () => {
  it('rounds to whole cents on the positive magnitude', () => {
    expect(applyShare(3_333, 0.4)).toBe(1_333);
    expect(applyShare(3_333, 0.6)).toBe(2_000);
    expect(applyShare(-1_000, 0.5)).toBe(500);
  });
});

describe('centsToInputValue', () => {
  it('renders a plain two-decimal string for form inputs', () => {
    expect(centsToInputValue(11_000)).toBe('110.00');
    expect(centsToInputValue(5)).toBe('0.05');
  });
});
