import { LedgerSettings } from '../domain/settings.model';
import { Transaction } from '../domain/transaction.model';
import { LedgerStorage, PersistedLedger } from './ledger-storage';

/**
 * Fallback for environments without IndexedDB (some private-browsing modes) and
 * for unit tests. `durable` is false so the UI can warn that nothing is saved.
 */
export class InMemoryLedgerStorage extends LedgerStorage {
  override readonly durable = false;
  private transactions = new Map<string, Transaction>();
  private settings: LedgerSettings | null = null;

  async load(): Promise<PersistedLedger> {
    return { transactions: [...this.transactions.values()], settings: this.settings };
  }

  async putTransaction(transaction: Transaction): Promise<void> {
    this.transactions.set(transaction.id, transaction);
  }

  async deleteTransaction(id: string): Promise<void> {
    this.transactions.delete(id);
  }

  async putSettings(settings: LedgerSettings): Promise<void> {
    this.settings = settings;
  }

  async replaceAll(transactions: readonly Transaction[], settings: LedgerSettings): Promise<void> {
    this.transactions = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    this.settings = settings;
  }
}
