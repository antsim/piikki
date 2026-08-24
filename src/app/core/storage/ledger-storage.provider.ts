import { inject, Provider } from '@angular/core';
import { AppConfigStore } from '../config/app-config.store';
import { InMemoryLedgerStorage } from './in-memory-ledger-storage';
import { IndexedDbLedgerStorage } from './indexed-db-ledger-storage';
import { LazySupabaseLedgerStorage } from './lazy-supabase-ledger-storage';
import { LedgerStorage } from './ledger-storage';

function createLocalLedgerStorage(): LedgerStorage {
  const hasIndexedDb = typeof indexedDB !== 'undefined';
  return hasIndexedDb ? new IndexedDbLedgerStorage() : new InMemoryLedgerStorage();
}

/**
 * Picks the adapter based on whether `config.json` asked for Supabase.
 * `AppConfigStore.load()` must have already resolved by the time this factory
 * runs — see the app-initializer sequencing in `app.config.ts` — otherwise
 * this always sees an empty config and falls back to local storage.
 */
export function createLedgerStorage(): LedgerStorage {
  const config = inject(AppConfigStore).config();
  return config ? new LazySupabaseLedgerStorage(config) : createLocalLedgerStorage();
}

export function provideLedgerStorage(): Provider {
  return { provide: LedgerStorage, useFactory: createLedgerStorage };
}
