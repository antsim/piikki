import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LedgerSettings } from '../domain/settings.model';
import { Transaction } from '../domain/transaction.model';
import { InMemoryOfflineStore } from './in-memory-offline-store';
import { LedgerStorage, PersistedLedger } from './ledger-storage';
import { OfflineQueueLedgerStorage } from './offline-queue-ledger-storage';

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

const OFFLINE = () => new TypeError('Failed to fetch');
const REJECTED = () => new Error('duplicate key value violates unique constraint');

/** A remote adapter whose next call can be told to fail, so tests can simulate going offline. */
class FakeRemoteStorage extends LedgerStorage {
  override readonly durable = true;
  override readonly backend = 'cloud' as const;

  failNextWith: (() => Error) | null = null;
  transactions: Transaction[] = [];
  settings: LedgerSettings = DEFAULT_SETTINGS;
  loadCount = 0;
  private readonly listeners = new Set<() => void>();

  async load(): Promise<PersistedLedger> {
    this.loadCount++;
    this.failIfAsked();
    return { transactions: this.transactions, settings: this.settings };
  }

  async putTransaction(t: Transaction): Promise<void> {
    this.failIfAsked();
    this.transactions = [...this.transactions.filter((x) => x.id !== t.id), t];
  }

  async deleteTransaction(id: string): Promise<void> {
    this.failIfAsked();
    this.transactions = this.transactions.filter((x) => x.id !== id);
  }

  async putSettings(settings: LedgerSettings): Promise<void> {
    this.failIfAsked();
    this.settings = settings;
  }

  async replaceAll(transactions: readonly Transaction[], settings: LedgerSettings): Promise<void> {
    this.failIfAsked();
    this.transactions = [...transactions];
    this.settings = settings;
  }

  override onRemoteChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private failIfAsked(): void {
    if (this.failNextWith) {
      const build = this.failNextWith;
      this.failNextWith = null;
      throw build();
    }
  }
}

describe('OfflineQueueLedgerStorage', () => {
  let remote: FakeRemoteStorage;
  let queue: OfflineQueueLedgerStorage;

  beforeEach(() => {
    remote = new FakeRemoteStorage();
    queue = new OfflineQueueLedgerStorage(remote, new InMemoryOfflineStore());
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('passes writes straight through while online', async () => {
    await queue.putTransaction(transaction());
    expect(remote.transactions).toEqual([transaction()]);
    expect(queue.pendingSyncCount()).toBe(0);
  });

  it('queues a write instead of throwing when it fails offline-shaped', async () => {
    remote.failNextWith = OFFLINE;

    await expect(queue.putTransaction(transaction())).resolves.toBeUndefined();

    expect(remote.transactions).toEqual([]); // never reached the "server"
    expect(queue.pendingSyncCount()).toBe(1);
  });

  it('lets a non-offline failure surface instead of queuing it', async () => {
    remote.failNextWith = REJECTED;

    await expect(queue.putTransaction(transaction())).rejects.toThrow(/unique constraint/);

    expect(queue.pendingSyncCount()).toBe(0);
  });

  it('treats navigator.onLine === false as offline even for an otherwise generic error', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    remote.failNextWith = REJECTED; // not TypeError/regex-shaped, but onLine says no network

    await expect(queue.putTransaction(transaction())).resolves.toBeUndefined();

    expect(queue.pendingSyncCount()).toBe(1);
  });

  it('replays a queued write once the app comes back online, then tells listeners to refresh', async () => {
    remote.failNextWith = OFFLINE;
    await queue.putTransaction(transaction());
    expect(queue.pendingSyncCount()).toBe(1);

    let refreshed = 0;
    queue.onRemoteChange(() => refreshed++);

    window.dispatchEvent(new Event('online'));
    await flushMicrotasks();

    expect(remote.transactions).toEqual([transaction()]);
    expect(queue.pendingSyncCount()).toBe(0);
    expect(refreshed).toBe(1);
  });

  it('collapses an edit-then-delete made offline into a single delete', async () => {
    remote.transactions = [transaction()]; // already exists on the "server"
    remote.failNextWith = OFFLINE;
    await queue.putTransaction(transaction({ description: 'edited' }));
    remote.failNextWith = OFFLINE;
    await queue.deleteTransaction('t1');

    expect(queue.pendingSyncCount()).toBe(1); // one row, one pending op

    window.dispatchEvent(new Event('online'));
    await flushMicrotasks();

    expect(remote.transactions).toEqual([]);
  });

  it('falls back to the last cached load when the remote is unreachable', async () => {
    remote.transactions = [transaction()];
    remote.settings = DEFAULT_SETTINGS;
    await queue.load(); // primes the cache

    remote.failNextWith = OFFLINE;
    const result = await queue.load();

    expect(result.transactions).toEqual([transaction()]);
  });

  it('re-applies a still-pending write on top of the cached fallback', async () => {
    await queue.load(); // empty cache, but primes it
    remote.failNextWith = OFFLINE;
    await queue.putTransaction(transaction());

    remote.failNextWith = OFFLINE;
    const result = await queue.load();

    expect(result.transactions).toEqual([transaction()]);
  });

  it('throws when offline with nothing cached yet', async () => {
    remote.failNextWith = OFFLINE;
    await expect(queue.load()).rejects.toThrow();
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
