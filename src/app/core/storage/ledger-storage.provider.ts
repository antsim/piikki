import { inject, Provider } from '@angular/core';
import { AppConfigStore } from '../config/app-config.store';
import { InMemoryLedgerStorage } from './in-memory-ledger-storage';
import { InMemoryOfflineStore } from './in-memory-offline-store';
import { IndexedDbLedgerStorage } from './indexed-db-ledger-storage';
import { IndexedDbOfflineStore } from './indexed-db-offline-store';
import { LazySupabaseLedgerStorage } from './lazy-supabase-ledger-storage';
import { LedgerStorage } from './ledger-storage';
import { OfflineQueueLedgerStorage } from './offline-queue-ledger-storage';
import { OfflineStore } from './offline-outbox';

function createLocalLedgerStorage(): LedgerStorage {
  const hasIndexedDb = typeof indexedDB !== 'undefined';
  return hasIndexedDb ? new IndexedDbLedgerStorage() : new InMemoryLedgerStorage();
}

function createOfflineStore(): OfflineStore {
  const hasIndexedDb = typeof indexedDB !== 'undefined';
  return hasIndexedDb ? new IndexedDbOfflineStore() : new InMemoryOfflineStore();
}

/**
 * Picks the adapter based on whether `config.json` asked for Supabase.
 * `AppConfigStore.load()` must have already resolved by the time this factory
 * runs — see the app-initializer sequencing in `app.config.ts` — otherwise
 * this always sees an empty config and falls back to local storage.
 *
 * Cloud mode is wrapped in OfflineQueueLedgerStorage so it keeps working
 * (reading cached data, queuing writes) while offline — see that class.
 * Local mode never needs it: IndexedDB has no concept of "offline" to begin
 * with.
 */
export function createLedgerStorage(): LedgerStorage {
  const config = inject(AppConfigStore).config();
  if (!config) {
    return createLocalLedgerStorage();
  }
  return new OfflineQueueLedgerStorage(new LazySupabaseLedgerStorage(config), createOfflineStore());
}

export function provideLedgerStorage(): Provider {
  return { provide: LedgerStorage, useFactory: createLedgerStorage };
}
