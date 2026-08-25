import { describe, expect, it } from 'vitest';
import {
  buildEntries,
  buildMonthSummary,
  balanceDeltaCents,
  ledgerAmountCents,
  listMonths,
  sharedAmountCents,
  signedSharePercent,
  totalBalanceCents,
} from './ledger';
import { DEFAULT_CATEGORIES } from './split-category.model';
import { Payer, PersonalAmounts, SplitTerms, Transaction } from './transaction.model';

const HOUSEHOLD: SplitTerms = { kind: 'expense', myShare: 0.6 };
const EVEN: SplitTerms = { kind: 'expense', myShare: 0.5 };
const SETTLEMENT: SplitTerms = { kind: 'settlement', myShare: 0 };

let sequence = 0;

function tx(
  amountCents: number,
  payer: Payer,
  split: SplitTerms,
  date = '2026-08-10',
  personal?: PersonalAmounts,
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
    personal,
    createdAt: created,
    updatedAt: created,
  };
}

/** A receipt with personal items on it, at the default test date. */
function receipt(
  amountCents: number,
  payer: Payer,
  split: SplitTerms,
  personal: PersonalAmounts,
): Transaction {
  return tx(amountCents, payer, split, '2026-08-10', personal);
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

describe('balanceDeltaCents with personal items', () => {
  // The worked example: a 100 € shop split down the middle, with 20 € of my
  // own things and 10 € of my partner's in the bag.
  //   shared 70 -> they owe 35, plus their own 10 in full = 45.
  const SHOP: PersonalAmounts = { mineCents: 2_000, partnerCents: 1_000 };

  it('splits only what is left after the personal items', () => {
    expect(sharedAmountCents(receipt(10_000, 'me', EVEN, SHOP))).toBe(7_000);
  });

  it('charges the partner their share plus their own items when I paid', () => {
    expect(balanceDeltaCents(receipt(10_000, 'me', EVEN, SHOP))).toBe(4_500);
  });

  it('charges me my share plus my own items when the partner paid', () => {
    expect(balanceDeltaCents(receipt(10_000, 'partner', EVEN, SHOP))).toBe(-5_500);
  });

  it('lets the payer buy their own things without moving the balance for them', () => {
    // 20 € of my own on a 100 € receipt I paid: my partner owes half of the
    // remaining 80, not half of the shampoo too.
    const mineOnly = { mineCents: 2_000, partnerCents: 0 };
    expect(balanceDeltaCents(receipt(10_000, 'me', EVEN, mineOnly))).toBe(4_000);
    // Same items on a receipt they paid: I owe my half plus my 20 in full.
    expect(balanceDeltaCents(receipt(10_000, 'partner', EVEN, mineOnly))).toBe(-6_000);
  });

  it('hands the whole thing over when nothing on the receipt was shared', () => {
    const allTheirs = { mineCents: 0, partnerCents: 10_000 };
    expect(sharedAmountCents(receipt(10_000, 'me', EVEN, allTheirs))).toBe(0);
    expect(balanceDeltaCents(receipt(10_000, 'me', EVEN, allTheirs))).toBe(10_000);
  });

  it('still respects an uneven category split on the shared remainder', () => {
    // 60/40 household: shared 70 -> partner owes 40% = 28, plus their own 10.
    expect(balanceDeltaCents(receipt(10_000, 'me', HOUSEHOLD, SHOP))).toBe(3_800);
  });

  it('ignores personal items on a settlement, which is never part-personal', () => {
    expect(balanceDeltaCents(receipt(25_000, 'partner', SETTLEMENT, SHOP))).toBe(-25_000);
    expect(sharedAmountCents(receipt(25_000, 'partner', SETTLEMENT, SHOP))).toBe(25_000);
  });
});

describe('ledgerAmountCents', () => {
  it('leaves an ordinary receipt alone', () => {
    expect(ledgerAmountCents(tx(10_000, 'me', EVEN))).toBe(10_000);
  });

  it("discounts the payer's own items, which never involved the other person", () => {
    const shop = { mineCents: 2_000, partnerCents: 1_000 };
    expect(ledgerAmountCents(receipt(10_000, 'me', EVEN, shop))).toBe(8_000);
    expect(ledgerAmountCents(receipt(10_000, 'partner', EVEN, shop))).toBe(9_000);
  });
});

describe('signedSharePercent', () => {
  it('shifts the share toward whoever the personal items belong to', () => {
    // I carry my own 20 plus half of the shared 70 = 55 of the 100 total.
    const shop = { mineCents: 2_000, partnerCents: 1_000 };
    expect(signedSharePercent(receipt(10_000, 'me', EVEN, shop))).toBe(55);
    expect(signedSharePercent(receipt(10_000, 'partner', EVEN, shop))).toBe(-45);
  });

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

  it("leaves the payer's own items out of what they paid toward the ledger", () => {
    const shopping = [receipt(10_000, 'me', EVEN, { mineCents: 2_000, partnerCents: 1_000 })];
    const august = buildMonthSummary(buildEntries(shopping, DEFAULT_CATEGORIES), '2026-08');
    // 100 € left my account, but 20 € of it was my own shampoo.
    expect(august.paidByMeCents).toBe(8_000);
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
