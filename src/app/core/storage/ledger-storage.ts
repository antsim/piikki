import { LedgerSettings } from '../domain/settings.model';
import { Transaction } from '../domain/transaction.model';

export interface PersistedLedger {
  readonly transactions: readonly Transaction[];
  readonly settings: LedgerSettings | null;
}

/**
 * Persistence port. The app only ever talks to this abstraction, so swapping
 * IndexedDB for a remote API later is a one-file change.
 */
export abstract class LedgerStorage {
  /** True when writes actually survive a reload. */
  abstract readonly durable: boolean;
  abstract load(): Promise<PersistedLedger>;
  abstract putTransaction(transaction: Transaction): Promise<void>;
  abstract deleteTransaction(id: string): Promise<void>;
  abstract putSettings(settings: LedgerSettings): Promise<void>;
  abstract replaceAll(transactions: readonly Transaction[], settings: LedgerSettings): Promise<void>;
}
