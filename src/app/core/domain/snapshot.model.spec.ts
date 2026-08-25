import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings.model';
import { createSnapshot, parseSnapshot, SNAPSHOT_VERSION } from './snapshot.model';
import { Transaction } from './transaction.model';

const TRANSACTION: Transaction = {
  id: 'tx-1',
  date: '2026-08-10',
  description: 'K-Market',
  amountCents: 10_000,
  payer: 'me',
  categoryId: 'shared',
  split: { kind: 'expense', myShare: 0.5 },
  personal: { mineCents: 2_000, partnerCents: 1_000 },
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-10T12:00:00.000Z',
};

/** The JSON a backup file actually holds, once it has been through the wire. */
function roundTrip(transaction: Transaction) {
  const snapshot = createSnapshot([transaction], DEFAULT_SETTINGS);
  return parseSnapshot(JSON.parse(JSON.stringify(snapshot)));
}

describe('parseSnapshot', () => {
  it('round-trips personal items through a backup file', () => {
    expect(roundTrip(TRANSACTION).transactions[0].personal).toEqual({
      mineCents: 2_000,
      partnerCents: 1_000,
    });
  });

  it('restores a v1 backup, which simply has nothing personal in it', () => {
    const snapshot = createSnapshot([TRANSACTION], DEFAULT_SETTINGS);
    const v1 = JSON.parse(JSON.stringify({ ...snapshot, version: 1 }));
    delete v1.transactions[0].personal;

    const parsed = parseSnapshot(v1);
    expect(parsed.transactions[0].personal).toBeUndefined();
    expect(parsed.transactions[0].amountCents).toBe(10_000);
  });

  it('refuses a backup written by a newer app rather than dropping what it cannot read', () => {
    const snapshot = createSnapshot([TRANSACTION], DEFAULT_SETTINGS);
    expect(() => parseSnapshot({ ...snapshot, version: SNAPSHOT_VERSION + 1 })).toThrow();
  });

  it('shrugs off personal items that are not usable numbers', () => {
    const snapshot = createSnapshot([TRANSACTION], DEFAULT_SETTINGS);
    const broken = JSON.parse(JSON.stringify(snapshot));
    broken.transactions[0].personal = { mineCents: 'lots', partnerCents: null };
    expect(parseSnapshot(broken).transactions[0].personal).toBeUndefined();
  });

  it('clamps personal items that add up to more than the transaction', () => {
    const snapshot = createSnapshot([TRANSACTION], DEFAULT_SETTINGS);
    const overflowing = JSON.parse(JSON.stringify(snapshot));
    overflowing.transactions[0].personal = { mineCents: 9_000, partnerCents: 9_000 };
    expect(parseSnapshot(overflowing).transactions[0].personal).toEqual({
      mineCents: 9_000,
      partnerCents: 1_000,
    });
  });
});
