import { describe, expect, it } from 'vitest';
import { LedgerSettings, DEFAULT_SETTINGS } from '../domain/settings.model';
import { Transaction } from '../domain/transaction.model';
import { PersistedLedger } from './ledger-storage';
import { applyOutbox, foldOutboxEntry } from './offline-outbox';

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    date: '2026-08-10',
    description: 'K-Market',
    amountCents: 10_000,
    payer: 'me',
    categoryId: 'household',
    split: { kind: 'expense', myShare: 0.6 },
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

function ledger(
  transactions: Transaction[] = [],
  settings: LedgerSettings | null = null,
): PersistedLedger {
  return { transactions, settings };
}

describe('applyOutbox', () => {
  it('adds a queued transaction that was never loaded', () => {
    const entry = foldOutboxEntry({ kind: 'putTransaction', transaction: transaction() });
    const result = applyOutbox(ledger(), [entry]);
    expect(result.transactions).toEqual([transaction()]);
  });

  it('overwrites a loaded transaction with a queued edit', () => {
    const original = transaction();
    const edited = transaction({ description: 'K-Market (edited)', amountCents: 12_000 });
    const entry = foldOutboxEntry({ kind: 'putTransaction', transaction: edited });

    const result = applyOutbox(ledger([original]), [entry]);

    expect(result.transactions).toEqual([edited]);
  });

  it('removes a loaded transaction on a queued delete', () => {
    const entry = foldOutboxEntry({ kind: 'deleteTransaction', id: 't1' });
    const result = applyOutbox(ledger([transaction()]), [entry]);
    expect(result.transactions).toEqual([]);
  });

  it('applies a queued settings change', () => {
    const settings: LedgerSettings = { ...DEFAULT_SETTINGS, myName: 'Antti' };
    const entry = foldOutboxEntry({ kind: 'putSettings', settings });
    const result = applyOutbox(ledger([], DEFAULT_SETTINGS), [entry]);
    expect(result.settings).toEqual(settings);
  });

  it('leaves the ledger untouched when nothing is queued', () => {
    const base = ledger([transaction()], DEFAULT_SETTINGS);
    expect(applyOutbox(base, [])).toEqual(base);
  });
});

describe('foldOutboxEntry', () => {
  it('keys a transaction put and delete the same way, so one replaces the other in a Map', () => {
    const put = foldOutboxEntry({ kind: 'putTransaction', transaction: transaction() });
    const del = foldOutboxEntry({ kind: 'deleteTransaction', id: 't1' });
    expect(put.key).toBe(del.key);
  });

  it('keys every settings change the same way — only the latest can ever be pending', () => {
    const first = foldOutboxEntry({ kind: 'putSettings', settings: DEFAULT_SETTINGS });
    const second = foldOutboxEntry({
      kind: 'putSettings',
      settings: { ...DEFAULT_SETTINGS, myName: 'Antti' },
    });
    expect(first.key).toBe(second.key);
  });

  it('keys different transactions differently', () => {
    const a = foldOutboxEntry({ kind: 'putTransaction', transaction: transaction({ id: 't1' }) });
    const b = foldOutboxEntry({ kind: 'putTransaction', transaction: transaction({ id: 't2' }) });
    expect(a.key).not.toBe(b.key);
  });
});
