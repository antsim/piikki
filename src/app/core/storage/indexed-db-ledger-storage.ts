import { LedgerSettings } from '../domain/settings.model';
import { Transaction } from '../domain/transaction.model';
import { openDatabase, runTransaction } from './indexed-db';
import { LedgerStorage, PersistedLedger } from './ledger-storage';

const DB_NAME = 'piikki';
const DB_VERSION = 1;
const TRANSACTIONS_STORE = 'transactions';
const META_STORE = 'meta';
const SETTINGS_KEY = 'settings';

/** Default adapter: everything lives in the browser's IndexedDB, no server involved. */
export class IndexedDbLedgerStorage extends LedgerStorage {
  override readonly durable = true;
  override readonly backend = 'local' as const;
  private db: Promise<IDBDatabase> | null = null;

  async load(): Promise<PersistedLedger> {
    const db = await this.database();
    let transactions: Transaction[] = [];
    let settings: LedgerSettings | undefined;

    await runTransaction(db, [TRANSACTIONS_STORE, META_STORE], 'readonly', (tx) => {
      const all = tx.objectStore(TRANSACTIONS_STORE).getAll();
      all.onsuccess = () => (transactions = all.result as Transaction[]);
      const meta = tx.objectStore(META_STORE).get(SETTINGS_KEY);
      meta.onsuccess = () => (settings = meta.result as LedgerSettings | undefined);
    });

    return { transactions, settings: settings ?? null };
  }

  async putTransaction(transaction: Transaction): Promise<void> {
    const db = await this.database();
    await runTransaction(db, [TRANSACTIONS_STORE], 'readwrite', (tx) => {
      tx.objectStore(TRANSACTIONS_STORE).put(transaction);
    });
  }

  async deleteTransaction(id: string): Promise<void> {
    const db = await this.database();
    await runTransaction(db, [TRANSACTIONS_STORE], 'readwrite', (tx) => {
      tx.objectStore(TRANSACTIONS_STORE).delete(id);
    });
  }

  async putSettings(settings: LedgerSettings): Promise<void> {
    const db = await this.database();
    await runTransaction(db, [META_STORE], 'readwrite', (tx) => {
      tx.objectStore(META_STORE).put(settings, SETTINGS_KEY);
    });
  }

  /** Used by backup import and "start over" — one atomic swap. */
  async replaceAll(transactions: readonly Transaction[], settings: LedgerSettings): Promise<void> {
    const db = await this.database();
    await runTransaction(db, [TRANSACTIONS_STORE, META_STORE], 'readwrite', (tx) => {
      const store = tx.objectStore(TRANSACTIONS_STORE);
      store.clear();
      for (const transaction of transactions) {
        store.put(transaction);
      }
      tx.objectStore(META_STORE).put(settings, SETTINGS_KEY);
    });
  }

  private database(): Promise<IDBDatabase> {
    this.db ??= openDatabase(DB_NAME, DB_VERSION, (db) => {
      if (!db.objectStoreNames.contains(TRANSACTIONS_STORE)) {
        db.createObjectStore(TRANSACTIONS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    });
    return this.db;
  }
}
