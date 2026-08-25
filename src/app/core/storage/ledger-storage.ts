import { LedgerSettings } from '../domain/settings.model';
import { Transaction } from '../domain/transaction.model';

export interface PersistedLedger {
  readonly transactions: readonly Transaction[];
  readonly settings: LedgerSettings | null;
}

/** A label the UI can show for "where is my data" without knowing the adapter. */
export type StorageBackend = 'local' | 'cloud';

/**
 * Persistence port. The app only ever talks to this abstraction, so swapping
 * IndexedDB for a remote API later is a one-file change.
 */
export abstract class LedgerStorage {
  /** True when writes actually survive a reload. */
  abstract readonly durable: boolean;
  /** Whether this adapter is device-local or shared with other devices. */
  abstract readonly backend: StorageBackend;

  abstract load(): Promise<PersistedLedger>;
  abstract putTransaction(transaction: Transaction): Promise<void>;
  abstract deleteTransaction(id: string): Promise<void>;
  abstract putSettings(settings: LedgerSettings): Promise<void>;
  abstract replaceAll(transactions: readonly Transaction[], settings: LedgerSettings): Promise<void>;

  /**
   * Notifies `listener` when the data changed somewhere other than through
   * this instance's own methods (e.g. the partner's device wrote to the
   * shared backend). Local-only adapters never fire it. Returns an
   * unsubscribe function; the default implementation is a no-op so adapters
   * without a remote to watch don't have to implement it.
   */
  onRemoteChange(_listener: () => void): () => void {
    return () => {};
  }

  /**
   * Writes made while offline and not yet synced to the remote backend.
   * Always 0 for local-only adapters — there's nothing to sync anywhere.
   * See OfflineQueueLedgerStorage, the only adapter that overrides this.
   */
  pendingSyncCount(): number {
    return 0;
  }

  /** Notifies `listener` whenever pendingSyncCount() changes. */
  onPendingSyncChange(_listener: (count: number) => void): () => void {
    return () => {};
  }
}
