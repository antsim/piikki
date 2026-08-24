import { AppConfig } from '../config/app-config.model';
import { LedgerSettings } from '../domain/settings.model';
import { Transaction } from '../domain/transaction.model';
import { LedgerStorage, PersistedLedger } from './ledger-storage';

/**
 * Defers loading `@supabase/supabase-js` (and the adapter itself) until it is
 * actually needed. Without this, importing `SupabaseLedgerStorage` at the top
 * of the storage provider — even just to reference the class — pulls the
 * whole Supabase SDK into everyone's initial bundle, including people who
 * never configure cloud sync. This wrapper is the only thing the provider
 * imports eagerly; the real adapter is a dynamic `import()` behind it, so it
 * lands in its own lazy chunk that local-only deployments never fetch.
 */
export class LazySupabaseLedgerStorage extends LedgerStorage {
  override readonly durable = true;
  override readonly backend = 'cloud' as const;

  private readonly real: Promise<LedgerStorage>;

  constructor(config: AppConfig) {
    super();
    this.real = import('./supabase-ledger-storage').then(
      ({ SupabaseLedgerStorage }) => new SupabaseLedgerStorage(config),
    );
  }

  async load(): Promise<PersistedLedger> {
    return (await this.real).load();
  }

  async putTransaction(transaction: Transaction): Promise<void> {
    return (await this.real).putTransaction(transaction);
  }

  async deleteTransaction(id: string): Promise<void> {
    return (await this.real).deleteTransaction(id);
  }

  async putSettings(settings: LedgerSettings): Promise<void> {
    return (await this.real).putSettings(settings);
  }

  async replaceAll(transactions: readonly Transaction[], settings: LedgerSettings): Promise<void> {
    return (await this.real).replaceAll(transactions, settings);
  }

  override onRemoteChange(listener: () => void): () => void {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    void this.real.then((real) => {
      if (cancelled) {
        return;
      }
      unsubscribe = real.onRemoteChange(listener);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }
}
