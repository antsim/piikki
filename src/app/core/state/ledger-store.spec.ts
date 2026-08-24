import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthStore } from '../auth/auth.store';
import { OPENING_BALANCE_CATEGORY_ID, SETTLEMENT_CATEGORY_ID } from '../domain/split-category.model';
import { Transaction, TransactionDraft } from '../domain/transaction.model';
import { InMemoryLedgerStorage } from '../storage/in-memory-ledger-storage';
import { LedgerStorage } from '../storage/ledger-storage';
import { LedgerStore } from './ledger-store';

function draft(overrides: Partial<TransactionDraft> = {}): TransactionDraft {
  return {
    date: '2026-08-10',
    description: 'K-Market',
    amountCents: 10_000,
    payer: 'me',
    categoryId: 'household',
    split: { kind: 'expense', myShare: 0.6 },
    ...overrides,
  };
}

describe('LedgerStore', () => {
  let store: LedgerStore;
  let storage: InMemoryLedgerStorage;

  beforeEach(async () => {
    storage = new InMemoryLedgerStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: LedgerStorage, useValue: storage }],
    });
    store = TestBed.inject(LedgerStore);
    await store.load();
  });

  it('starts empty with the default split rules', () => {
    expect(store.balanceCents()).toBe(0);
    expect(store.selectableCategories().map((category) => category.id)).toEqual([
      'household',
      'shared',
      SETTLEMENT_CATEGORY_ID,
      OPENING_BALANCE_CATEGORY_ID,
    ]);
  });

  it('sets an opening balance in the chosen direction, using the same math as a settlement', async () => {
    expect(store.hasOpeningBalance()).toBe(false);

    await store.addTransaction(
      draft({
        description: 'Opening balance',
        amountCents: 14_250,
        payer: 'me',
        categoryId: OPENING_BALANCE_CATEGORY_ID,
        split: { kind: 'settlement', myShare: 0 },
      }),
    );

    expect(store.balanceCents()).toBe(14_250);
    expect(store.hasOpeningBalance()).toBe(true);
  });

  it('moves the opening balance the other way when it favors the partner', async () => {
    await store.addTransaction(
      draft({
        payer: 'partner',
        categoryId: OPENING_BALANCE_CATEGORY_ID,
        split: { kind: 'settlement', myShare: 0 },
        amountCents: 8_000,
      }),
    );

    expect(store.balanceCents()).toBe(-8_000);
  });

  it('adds a transaction and moves the balance', async () => {
    await store.addTransaction(draft());
    expect(store.balanceCents()).toBe(4_000);
    expect(store.transactions()).toHaveLength(1);
  });

  it('persists through storage so a reload keeps the data', async () => {
    await store.addTransaction(draft());
    const reloaded = await storage.load();
    expect(reloaded.transactions).toHaveLength(1);
    expect(reloaded.transactions[0].amountCents).toBe(10_000);
  });

  it('normalises a negative amount and trims the description', async () => {
    const saved = await store.addTransaction(draft({ amountCents: -2_500, description: '  Prisma  ' }));
    expect(saved.amountCents).toBe(2_500);
    expect(saved.description).toBe('Prisma');
  });

  it('recalculates the balance when a transaction is edited', async () => {
    const saved = await store.addTransaction(draft());
    await store.updateTransaction(saved.id, draft({ payer: 'partner' }));
    expect(store.balanceCents()).toBe(-6_000);
  });

  it('supports delete and undo', async () => {
    const saved = await store.addTransaction(draft());
    await store.deleteTransaction(saved.id);
    expect(store.balanceCents()).toBe(0);

    await store.restoreTransaction(saved);
    expect(store.balanceCents()).toBe(4_000);
    expect(store.transactions()).toHaveLength(1);
  });

  it('un-hides the opening-balance chip again if that entry is deleted', async () => {
    const saved = await store.addTransaction(
      draft({ categoryId: OPENING_BALANCE_CATEGORY_ID, split: { kind: 'settlement', myShare: 0 } }),
    );
    expect(store.hasOpeningBalance()).toBe(true);

    await store.deleteTransaction(saved.id);
    expect(store.hasOpeningBalance()).toBe(false);
  });

  it('rolls the optimistic update back when the write fails', async () => {
    const boom = new Error('quota exceeded');
    storage.putTransaction = () => Promise.reject(boom);

    await store.addTransaction(draft());

    expect(store.transactions()).toHaveLength(0);
    expect(store.error()).toContain('quota exceeded');
  });

  it('carries the previous month balance into the selected month', async () => {
    await store.addTransaction(draft({ date: '2026-07-04' }));
    await store.addTransaction(draft({ date: '2026-08-04', amountCents: 5_000 }));

    store.showMonth('2026-08');
    const summary = store.monthSummary();

    expect(summary.openingCents).toBe(4_000);
    expect(summary.closingCents).toBe(6_000);
    expect(summary.entries).toHaveLength(1);
  });

  it('offers previously used places for autocomplete, newest first', async () => {
    await store.addTransaction(draft({ description: 'K-Market', date: '2026-08-01' }));
    await store.addTransaction(draft({ description: 'Prisma', date: '2026-08-02' }));
    await store.addTransaction(draft({ description: 'K-Market', date: '2026-08-03' }));

    expect(store.knownDescriptions()).toEqual(['K-Market', 'Prisma']);
  });

  it('keeps split rule edits away from transactions already saved', async () => {
    await store.addTransaction(draft());
    await store.saveCategory({ id: 'household', label: 'Household', kind: 'expense', myShare: 0.8 });

    expect(store.balanceCents()).toBe(4_000);
  });
});

describe('LedgerStore auth gating', () => {
  it('waits for the auth gate before loading itself, then loads exactly once', async () => {
    const storage = new InMemoryLedgerStorage();
    const seeded: Transaction = {
      id: 'tx-1',
      date: '2026-08-10',
      description: 'K-Market',
      amountCents: 10_000,
      payer: 'me',
      categoryId: 'household',
      split: { kind: 'expense', myShare: 0.6 },
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    await storage.putTransaction(seeded);

    TestBed.configureTestingModule({ providers: [{ provide: LedgerStorage, useValue: storage }] });
    const store = TestBed.inject(LedgerStore);
    const auth = TestBed.inject(AuthStore);
    const appRef = TestBed.inject(ApplicationRef);

    // Cloud mode, nobody signed in yet: no auto-load.
    expect(store.status()).toBe('loading');
    expect(store.transactions()).toEqual([]);

    // The gate opens (here: local mode deciding there's nothing to log into,
    // exactly what app.config.ts does for a config-less deployment).
    auth.disable();
    await appRef.whenStable();

    expect(store.status()).toBe('ready');
    expect(store.transactions()).toHaveLength(1);
  });
});
