import { PersistedLedger } from './ledger-storage';
import { OfflineStore, OutboxEntry } from './offline-outbox';

/**
 * Fallback OfflineStore for browsers without IndexedDB (some private-
 * browsing modes) and for tests — nothing survives a reload, same trade-off
 * as InMemoryLedgerStorage for the local adapter.
 */
export class InMemoryOfflineStore implements OfflineStore {
  private cache: PersistedLedger | null = null;
  private readonly outbox = new Map<string, OutboxEntry>();

  async readCache(): Promise<PersistedLedger | null> {
    return this.cache;
  }

  async writeCache(ledger: PersistedLedger): Promise<void> {
    this.cache = ledger;
  }

  async listOutbox(): Promise<OutboxEntry[]> {
    return [...this.outbox.values()].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  async putOutboxEntry(entry: OutboxEntry): Promise<void> {
    this.outbox.set(entry.key, entry);
  }

  async removeOutboxEntry(key: string): Promise<void> {
    this.outbox.delete(key);
  }
}
