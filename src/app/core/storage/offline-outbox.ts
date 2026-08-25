import { LedgerSettings } from '../domain/settings.model';
import { Transaction } from '../domain/transaction.model';
import { PersistedLedger } from './ledger-storage';

/** A write that couldn't reach the remote backend and is waiting to be replayed. */
export type OutboxOperation =
  | { readonly kind: 'putTransaction'; readonly transaction: Transaction }
  | { readonly kind: 'deleteTransaction'; readonly id: string }
  | { readonly kind: 'putSettings'; readonly settings: LedgerSettings };

export interface OutboxEntry {
  /** One row's worth of pending writes collapse onto this key — see foldOutboxEntry. */
  readonly key: string;
  readonly operation: OutboxOperation;
  readonly queuedAt: string;
}

/**
 * Persistence for the outbox (pending writes) and a cache of the last
 * successfully loaded ledger, so a reload while offline still has something
 * to show. A plain port like `LedgerStorage` — see IndexedDbOfflineStore and
 * InMemoryOfflineStore for the two implementations.
 */
export interface OfflineStore {
  readCache(): Promise<PersistedLedger | null>;
  writeCache(ledger: PersistedLedger): Promise<void>;
  listOutbox(): Promise<OutboxEntry[]>;
  putOutboxEntry(entry: OutboxEntry): Promise<void>;
  removeOutboxEntry(key: string): Promise<void>;
}

function outboxKey(operation: OutboxOperation): string {
  switch (operation.kind) {
    case 'putTransaction':
      return `transaction:${operation.transaction.id}`;
    case 'deleteTransaction':
      return `transaction:${operation.id}`;
    case 'putSettings':
      return 'settings';
  }
}

/**
 * Builds the entry a new operation collapses onto in the queue. A later
 * operation on the same row always replaces an earlier one outright —
 * there's no need to keep both:
 *  - put after put (two edits while offline): only the latest matters.
 *  - delete after put: send the delete. Even when the put was itself a
 *    brand-new row the server has never seen, deleting an id it doesn't
 *    have is a harmless no-op — so it's always safe to just send it, with
 *    no need to track whether the row was ever actually synced.
 *  - put after delete (undo, or the id got reused): the put wins, same as
 *    above.
 */
export function foldOutboxEntry(operation: OutboxOperation): OutboxEntry {
  return { key: outboxKey(operation), operation, queuedAt: new Date().toISOString() };
}

/**
 * Replays queued-but-not-yet-synced operations on top of a loaded ledger, so
 * a reload while offline (or the cached fallback below) still reflects
 * edits that haven't reached the server yet.
 */
export function applyOutbox(
  ledger: PersistedLedger,
  entries: readonly OutboxEntry[],
): PersistedLedger {
  if (!entries.length) {
    return ledger;
  }
  let transactions = ledger.transactions;
  let settings = ledger.settings;
  for (const { operation } of entries) {
    switch (operation.kind) {
      case 'putTransaction': {
        const { transaction } = operation;
        const exists = transactions.some((t) => t.id === transaction.id);
        transactions = exists
          ? transactions.map((t) => (t.id === transaction.id ? transaction : t))
          : [...transactions, transaction];
        break;
      }
      case 'deleteTransaction':
        transactions = transactions.filter((t) => t.id !== operation.id);
        break;
      case 'putSettings':
        settings = operation.settings;
        break;
    }
  }
  return { transactions, settings };
}
