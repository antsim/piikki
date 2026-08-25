import { describe, expect, it } from 'vitest';
import { normalisePersonalAmounts, personalAmountsOf } from './transaction.model';

describe('personalAmountsOf', () => {
  it('reads a missing field as nothing personal', () => {
    expect(personalAmountsOf({})).toEqual({ mineCents: 0, partnerCents: 0 });
  });
});

describe('normalisePersonalAmounts', () => {
  it('keeps amounts that fit inside the receipt', () => {
    expect(normalisePersonalAmounts({ mineCents: 2_000, partnerCents: 1_000 }, 10_000)).toEqual({
      mineCents: 2_000,
      partnerCents: 1_000,
    });
  });

  it('drops the field entirely when nothing is personal', () => {
    expect(normalisePersonalAmounts(undefined, 10_000)).toBeUndefined();
    expect(normalisePersonalAmounts({ mineCents: 0, partnerCents: 0 }, 10_000)).toBeUndefined();
  });

  it('clamps a total that overflows the receipt, filling mine first', () => {
    expect(normalisePersonalAmounts({ mineCents: 8_000, partnerCents: 8_000 }, 10_000)).toEqual({
      mineCents: 8_000,
      partnerCents: 2_000,
    });
  });

  it('clamps a single amount that is larger than the whole receipt', () => {
    expect(normalisePersonalAmounts({ mineCents: 99_000, partnerCents: 500 }, 10_000)).toEqual({
      mineCents: 10_000,
      partnerCents: 0,
    });
  });

  it('treats negative and non-finite figures as zero rather than trusting them', () => {
    expect(normalisePersonalAmounts({ mineCents: -500, partnerCents: 1_000 }, 10_000)).toEqual({
      mineCents: 0,
      partnerCents: 1_000,
    });
    expect(
      normalisePersonalAmounts({ mineCents: Number.NaN, partnerCents: 1_000 }, 10_000),
    ).toEqual({ mineCents: 0, partnerCents: 1_000 });
  });

  it('rounds fractional cents to whole ones', () => {
    expect(normalisePersonalAmounts({ mineCents: 1_000.4, partnerCents: 0 }, 10_000)).toEqual({
      mineCents: 1_000,
      partnerCents: 0,
    });
  });
});
