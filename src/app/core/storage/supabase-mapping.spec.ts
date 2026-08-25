import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../domain/settings.model';
import { Transaction } from '../domain/transaction.model';
import {
  rowToSettings,
  rowToTransaction,
  SETTINGS_ROW_ID,
  settingsToRow,
  transactionToRow,
} from './supabase-mapping';

const TRANSACTION: Transaction = {
  id: 'tx-1',
  date: '2026-08-10',
  description: 'K-Market',
  amountCents: 10_000,
  payer: 'me',
  categoryId: 'household',
  split: { kind: 'expense', myShare: 0.6 },
  note: 'weekly groceries',
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-10T12:00:00.000Z',
};

describe('transaction row mapping', () => {
  it('round-trips a transaction through the row shape', () => {
    expect(rowToTransaction(transactionToRow(TRANSACTION))).toEqual(TRANSACTION);
  });

  it('drops a null note back to undefined', () => {
    const row = transactionToRow({ ...TRANSACTION, note: undefined });
    expect(row.note).toBeNull();
    expect(rowToTransaction(row).note).toBeUndefined();
  });

  it('round-trips personal items', () => {
    const withPersonal: Transaction = {
      ...TRANSACTION,
      personal: { mineCents: 2_000, partnerCents: 1_000 },
    };
    const row = transactionToRow(withPersonal);
    expect(row.personal_mine_cents).toBe(2_000);
    expect(row.personal_partner_cents).toBe(1_000);
    expect(rowToTransaction(row)).toEqual(withPersonal);
  });

  it('reads a row from a table without the personal columns as nothing personal', () => {
    // A project that has not re-run schema.sql yet still has to load.
    const { personal_mine_cents, personal_partner_cents, ...legacy } =
      transactionToRow(TRANSACTION);
    expect(rowToTransaction(legacy).personal).toBeUndefined();
  });

  it('clamps personal amounts that do not fit the row amount', () => {
    const row = { ...transactionToRow(TRANSACTION), personal_mine_cents: 99_000 };
    expect(rowToTransaction(row).personal).toEqual({ mineCents: 10_000, partnerCents: 0 });
  });

  it('rejects a row with a bad payer or date', () => {
    expect(() => rowToTransaction({ ...transactionToRow(TRANSACTION), payer: 'someone' })).toThrow();
    expect(() => rowToTransaction({ ...transactionToRow(TRANSACTION), date: 'not-a-date' })).toThrow();
  });
});

describe('settings row mapping', () => {
  it('round-trips settings through the row shape', () => {
    const settings = { ...DEFAULT_SETTINGS, lastExportAt: '2026-08-01T00:00:00.000Z' };
    const row = settingsToRow(settings);
    expect(row.id).toBe(SETTINGS_ROW_ID);
    expect(rowToSettings(row)).toEqual(settings);
  });

  it('falls back to default categories when the stored value is not an array', () => {
    const row = settingsToRow(DEFAULT_SETTINGS);
    expect(rowToSettings({ ...row, categories: null }).categories).toBe(DEFAULT_SETTINGS.categories);
  });
});
