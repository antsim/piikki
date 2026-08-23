import { Provider } from '@angular/core';
import { InMemoryLedgerStorage } from './in-memory-ledger-storage';
import { IndexedDbLedgerStorage } from './indexed-db-ledger-storage';
import { LedgerStorage } from './ledger-storage';

export function createLedgerStorage(): LedgerStorage {
  const hasIndexedDb = typeof indexedDB !== 'undefined';
  return hasIndexedDb ? new IndexedDbLedgerStorage() : new InMemoryLedgerStorage();
}

export function provideLedgerStorage(): Provider {
  return { provide: LedgerStorage, useFactory: createLedgerStorage };
}
