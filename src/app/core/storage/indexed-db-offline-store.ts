import { openDatabase, runTransaction } from './indexed-db';
import { PersistedLedger } from './ledger-storage';
import { OfflineStore, OutboxEntry } from './offline-outbox';

const DB_NAME = 'piikki-offline';
const DB_VERSION = 1;
const CACHE_STORE = 'cache';
const OUTBOX_STORE = 'outbox';
const CACHE_KEY = 'snapshot';

/**
 * IndexedDB-backed OfflineStore. A separate database from the main
 * `piikki` one (see IndexedDbLedgerStorage) — this only ever backs the
 * cloud adapter's offline queue, never the local one, so keeping it apart
 * means a local-mode deployment (which never constructs this class) never
 * even creates the database.
 */
export class IndexedDbOfflineStore implements OfflineStore {
  private db: Promise<IDBDatabase> | null = null;

  async readCache(): Promise<PersistedLedger | null> {
    const db = await this.database();
    let result: PersistedLedger | undefined;
    await runTransaction(db, [CACHE_STORE], 'readonly', (tx) => {
      const request = tx.objectStore(CACHE_STORE).get(CACHE_KEY);
      request.onsuccess = () => (result = request.result as PersistedLedger | undefined);
    });
    return result ?? null;
  }

  async writeCache(ledger: PersistedLedger): Promise<void> {
    const db = await this.database();
    await runTransaction(db, [CACHE_STORE], 'readwrite', (tx) => {
      tx.objectStore(CACHE_STORE).put(ledger, CACHE_KEY);
    });
  }

  async listOutbox(): Promise<OutboxEntry[]> {
    const db = await this.database();
    let result: OutboxEntry[] = [];
    await runTransaction(db, [OUTBOX_STORE], 'readonly', (tx) => {
      const request = tx.objectStore(OUTBOX_STORE).getAll();
      request.onsuccess = () => (result = request.result as OutboxEntry[]);
    });
    return result.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  async putOutboxEntry(entry: OutboxEntry): Promise<void> {
    const db = await this.database();
    await runTransaction(db, [OUTBOX_STORE], 'readwrite', (tx) => {
      tx.objectStore(OUTBOX_STORE).put(entry);
    });
  }

  async removeOutboxEntry(key: string): Promise<void> {
    const db = await this.database();
    await runTransaction(db, [OUTBOX_STORE], 'readwrite', (tx) => {
      tx.objectStore(OUTBOX_STORE).delete(key);
    });
  }

  private database(): Promise<IDBDatabase> {
    this.db ??= openDatabase(DB_NAME, DB_VERSION, (db) => {
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE);
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'key' });
      }
    });
    return this.db;
  }
}
