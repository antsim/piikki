import { describe, expect, it } from 'vitest';
import { buildEntries, buildMonthSummary, balanceDeltaCents, listMonths, signedSharePercent, totalBalanceCents } from './ledger';
import { DEFAULT_CATEGORIES } from './split-category.model';
import { Payer, SplitTerms, Transaction } from './transaction.model';

const HOUSEHOLD: SplitTerms = { kind: 'expense', myShare: 0.6 };
const EVEN: SplitTerms = { kind: 'expense', myShare: 0.5 };
const SETTLEMENT: SplitTerms = { kind: 'settlement', myShare: 0 };

let sequence = 0;

function tx(
  amountCents: number,
  payer: Payer,
  split: SplitTerms,
  date = '2026-08-10',
): Transaction {
  const created = `2026-08-10T00:00:${String(sequence++).padStart(2, '0')}.000Z`;
  return {
    id: `tx-${sequence}`,
    date,
    description: 'K-Market',
    amountCents,
    payer,
    categoryId: split.kind === 'settlement' ? 'settlement' : 'household',
    split,
    createdAt: created,
    updatedAt: created,
  };
}

describe('balanceDeltaCents', () => {
  it('credits me the partner share of a household bill I paid', () => {
    expect(balanceDeltaCents(tx(10_000, 'me', HOUSEHOLD))).toBe(4_000);
  });

  it('debits me my 60% of a household bill the partner paid', () => {
    expect(balanceDeltaCents(tx(10_000, 'partner', HOUSEHOLD))).toBe(-6_000);
  });

  it('splits everything else down the middle in both directions', () => {
    expect(balanceDeltaCents(tx(6_000, 'me', EVEN))).toBe(3_000);
    expect(balanceDeltaCents(tx(6_000, 'partner', EVEN))).toBe(-3_000);
  });

  it('clears the balance one-for-one when the partner pays me back', () => {
    expect(balanceDeltaCents(tx(25_000, 'partner', SETTLEMENT))).toBe(-25_000);
  });

  it('moves the balance the other way when I pay the partner back', () => {
    expect(balanceDeltaCents(tx(25_000, 'me', SETTLEMENT))).toBe(25_000);
  });

  it('rounds odd cents to whole cents', () => {
    // 33.33 * 40% = 13.332 -> 13.33
    expect(balanceDeltaCents(tx(3_333, 'me', HOUSEHOLD))).toBe(1_333);
    // 33.33 * 60% = 19.998 -> 20.00
    expect(balanceDeltaCents(tx(3_333, 'partner', HOUSEHOLD))).toBe(-2_000);
  });

  it('ignores a stray negative amount instead of flipping the direction twice', () => {
    expect(balanceDeltaCents(tx(-10_000, 'me', HOUSEHOLD))).toBe(4_000);
  });
});

describe('signedSharePercent', () => {
  it('reproduces the percentages from the spreadsheet', () => {
    expect(signedSharePercent(tx(1, 'me', HOUSEHOLD))).toBe(60);
    expect(signedSharePercent(tx(1, 'partner', HOUSEHOLD))).toBe(-40);
    expect(signedSharePercent(tx(1, 'me', EVEN))).toBe(50);
    expect(signedSharePercent(tx(1, 'partner', EVEN))).toBe(-50);
    expect(signedSharePercent(tx(1, 'partner', SETTLEMENT))).toBe(-100);
    expect(signedSharePercent(tx(1, 'me', SETTLEMENT))).toBe(100);
  });
});

describe('buildEntries', () => {
  it('produces a running balance in chronological order', () => {
    const transactions = [
      tx(10_000, 'me', HOUSEHOLD, '2026-08-03'),
      tx(6_000, 'me', EVEN, '2026-08-01'),
      tx(5_000, 'partner', SETTLEMENT, '2026-08-05'),
    ];
    const entries = buildEntries(transactions, DEFAULT_CATEGORIES);

    expect(entries.map((entry) => entry.transaction.date)).toEqual([
      '2026-08-01',
      '2026-08-03',
      '2026-08-05',
    ]);
    expect(entries.map((entry) => entry.balanceAfterCents)).toEqual([3_000, 7_000, 2_000]);
    expect(totalBalanceCents(transactions)).toBe(2_000);
  });

  it('resolves the category label for each entry', () => {
    const [entry] = buildEntries([tx(1_000, 'me', HOUSEHOLD)], DEFAULT_CATEGORIES);
    expect(entry.category?.label).toBe('Household');
  });

  it('tolerates a transaction whose category no longer exists', () => {
    const [entry] = buildEntries([tx(1_000, 'me', HOUSEHOLD)], []);
    expect(entry.category).toBeUndefined();
    expect(entry.deltaCents).toBe(400);
  });
});

describe('buildMonthSummary', () => {
  const transactions = [
    tx(10_000, 'me', HOUSEHOLD, '2026-06-15'), // +4000
    tx(20_000, 'me', HOUSEHOLD, '2026-07-02'), // +8000
    tx(5_000, 'partner', SETTLEMENT, '2026-07-28'), // -5000
    tx(3_000, 'partner', EVEN, '2026-08-04'), // -1500
    tx(10_000, 'me', EVEN, '2026-08-09'), // +5000
  ];
  const entries = buildEntries(transactions, DEFAULT_CATEGORIES);

  it('carries the previous months balance into the opening balance', () => {
    const july = buildMonthSummary(entries, '2026-07');
    expect(july.openingCents).toBe(4_000);
    expect(july.closingCents).toBe(7_000);

    const august = buildMonthSummary(entries, '2026-08');
    expect(august.openingCents).toBe(7_000);
    expect(august.closingCents).toBe(10_500);
  });

  it('only lists the transactions of the requested month', () => {
    const august = buildMonthSummary(entries, '2026-08');
    expect(august.entries).toHaveLength(2);
    expect(august.paidByMeCents).toBe(10_000);
    expect(august.paidByPartnerCents).toBe(3_000);
  });

  it('keeps the carried balance for a month with no activity', () => {
    const september = buildMonthSummary(entries, '2026-09');
    expect(september.entries).toHaveLength(0);
    expect(september.openingCents).toBe(10_500);
    expect(september.closingCents).toBe(10_500);
  });

  it('counts settlements separately from spending', () => {
    const july = buildMonthSummary(entries, '2026-07');
    expect(july.settledCents).toBe(5_000);
    expect(july.paidByMeCents).toBe(20_000);
  });
});

describe('listMonths', () => {
  it('lists months newest first and always includes the current one', () => {
    const transactions = [
      tx(100, 'me', EVEN, '2026-06-15'),
      tx(100, 'me', EVEN, '2026-08-15'),
    ];
    expect(listMonths(transactions, '2026-09')).toEqual(['2026-09', '2026-08', '2026-06']);
  });
});
