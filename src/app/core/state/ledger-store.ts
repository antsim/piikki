import { computed, inject, Injectable, signal } from '@angular/core';
import { currentMonthKey, MonthKey } from '../domain/dates';
import {
  buildEntries,
  buildMonthSummary,
  listMonths,
  totalBalanceCents,
} from '../domain/ledger';
import { DEFAULT_SETTINGS, LedgerSettings } from '../domain/settings.model';
import { LedgerSnapshot } from '../domain/snapshot.model';
import { SplitCategory } from '../domain/split-category.model';
import { Transaction, TransactionDraft } from '../domain/transaction.model';
import { LedgerStorage } from '../storage/ledger-storage';

export type LedgerStatus = 'loading' | 'ready' | 'error';

/**
 * The one place mutable application state lives. Components read signals and
 * call intent methods; nothing else touches storage.
 *
 * Writes are optimistic: the signal updates immediately so the UI stays snappy,
 * and a failed persist rolls the change back and surfaces an error.
 */
@Injectable({ providedIn: 'root' })
export class LedgerStore {
  private readonly storage = inject(LedgerStorage);

  private readonly transactionsSignal = signal<readonly Transaction[]>([]);
  private readonly settingsSignal = signal<LedgerSettings>(DEFAULT_SETTINGS);
  private readonly statusSignal = signal<LedgerStatus>('loading');
  private readonly errorSignal = signal<string | null>(null);

  /** Which month the ledger view is showing. */
  readonly selectedMonth = signal<MonthKey>(currentMonthKey());

  readonly transactions = this.transactionsSignal.asReadonly();
  readonly settings = this.settingsSignal.asReadonly();
  readonly status = this.statusSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  /** False when the browser gave us no persistent storage — the UI warns about it. */
  readonly durable = this.storage.durable;
  /** 'cloud' once config.json points at Supabase; 'local' means IndexedDB only. */
  readonly backend = this.storage.backend;

  private refreshInFlight = false;
  private refreshQueued = false;

  constructor() {
    // A cloud backend calls this when the *other* device writes something;
    // local adapters never fire it.
    this.storage.onRemoteChange(() => void this.refreshFromRemote());
  }

  readonly categories = computed(() => this.settingsSignal().categories);
  readonly selectableCategories = computed(() =>
    this.categories().filter((category) => !category.archived),
  );

  /** Every transaction, chronological, with its balance delta and running total. */
  readonly entries = computed(() => buildEntries(this.transactionsSignal(), this.categories()));

  /** The bottom-line figure: positive = partner owes me. */
  readonly balanceCents = computed(() => totalBalanceCents(this.transactionsSignal()));

  readonly months = computed(() => listMonths(this.transactionsSignal(), currentMonthKey()));

  readonly monthSummary = computed(() => buildMonthSummary(this.entries(), this.selectedMonth()));

  /** Previously used descriptions, newest first — feeds the input's autocomplete. */
  readonly knownDescriptions = computed(() => {
    const seen = new Set<string>();
    for (let i = this.entries().length - 1; i >= 0; i--) {
      const description = this.entries()[i].transaction.description.trim();
      if (description) {
        seen.add(description);
      }
    }
    return [...seen].slice(0, 40);
  });

  async load(): Promise<void> {
    this.statusSignal.set('loading');
    try {
      const { transactions, settings } = await this.storage.load();
      this.transactionsSignal.set(transactions);
      this.settingsSignal.set(settings ? mergeSettings(settings) : DEFAULT_SETTINGS);
      this.statusSignal.set('ready');
      this.errorSignal.set(null);
    } catch (error) {
      this.statusSignal.set('error');
      const fallback = this.backend === 'cloud' ? 'Could not reach the cloud database.' : 'Could not open local storage.';
      this.errorSignal.set(describe(error, fallback));
    }
  }

  async addTransaction(draft: TransactionDraft): Promise<Transaction> {
    const now = new Date().toISOString();
    const transaction: Transaction = {
      ...draft,
      description: draft.description.trim(),
      amountCents: Math.round(Math.abs(draft.amountCents)),
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await this.persist(
      (current) => [...current, transaction],
      () => this.storage.putTransaction(transaction),
      'Could not save the transaction.',
    );
    return transaction;
  }

  async updateTransaction(id: string, draft: TransactionDraft): Promise<void> {
    const existing = this.transactionsSignal().find((transaction) => transaction.id === id);
    if (!existing) {
      return;
    }
    const updated: Transaction = {
      ...existing,
      ...draft,
      description: draft.description.trim(),
      amountCents: Math.round(Math.abs(draft.amountCents)),
      updatedAt: new Date().toISOString(),
    };
    await this.persist(
      (current) => current.map((transaction) => (transaction.id === id ? updated : transaction)),
      () => this.storage.putTransaction(updated),
      'Could not update the transaction.',
    );
  }

  async deleteTransaction(id: string): Promise<void> {
    await this.persist(
      (current) => current.filter((transaction) => transaction.id !== id),
      () => this.storage.deleteTransaction(id),
      'Could not delete the transaction.',
    );
  }

  /** Puts a deleted transaction back, keeping its original id and timestamps (undo). */
  async restoreTransaction(transaction: Transaction): Promise<void> {
    await this.persist(
      (current) => [...current.filter((item) => item.id !== transaction.id), transaction],
      () => this.storage.putTransaction(transaction),
      'Could not restore the transaction.',
    );
  }

  async updateSettings(patch: Partial<LedgerSettings>): Promise<void> {
    const next = { ...this.settingsSignal(), ...patch };
    const previous = this.settingsSignal();
    this.settingsSignal.set(next);
    try {
      await this.storage.putSettings(next);
    } catch (error) {
      this.settingsSignal.set(previous);
      this.errorSignal.set(describe(error, 'Could not save settings.'));
    }
  }

  async saveCategory(category: SplitCategory): Promise<void> {
    const categories = this.categories();
    const exists = categories.some((item) => item.id === category.id);
    await this.updateSettings({
      categories: exists
        ? categories.map((item) => (item.id === category.id ? category : item))
        : [...categories, category],
    });
  }

  /** Replaces everything with the contents of a backup file. */
  async importSnapshot(snapshot: LedgerSnapshot): Promise<void> {
    const previousTransactions = this.transactionsSignal();
    const previousSettings = this.settingsSignal();
    const settings = mergeSettings(snapshot.settings);
    this.transactionsSignal.set(snapshot.transactions);
    this.settingsSignal.set(settings);
    try {
      await this.storage.replaceAll(snapshot.transactions, settings);
    } catch (error) {
      this.transactionsSignal.set(previousTransactions);
      this.settingsSignal.set(previousSettings);
      this.errorSignal.set(describe(error, 'Could not import the backup.'));
      throw error;
    }
  }

  /** Deletes every transaction but keeps names and categories. */
  async clearTransactions(): Promise<void> {
    const settings = this.settingsSignal();
    const previous = this.transactionsSignal();
    this.transactionsSignal.set([]);
    try {
      await this.storage.replaceAll([], settings);
    } catch (error) {
      this.transactionsSignal.set(previous);
      this.errorSignal.set(describe(error, 'Could not clear the ledger.'));
    }
  }

  /**
   * Re-fetches everything after a remote-change notification. Bursts of
   * events (e.g. a bulk import on the other device) are coalesced into one
   * trailing refresh instead of one fetch per row. Failures are quiet — a
   * blip in connectivity shouldn't spam the error banner; the next
   * successful refresh or the next write recovers.
   */
  private async refreshFromRemote(): Promise<void> {
    if (this.refreshInFlight) {
      this.refreshQueued = true;
      return;
    }
    this.refreshInFlight = true;
    try {
      do {
        this.refreshQueued = false;
        const { transactions, settings } = await this.storage.load();
        this.transactionsSignal.set(transactions);
        if (settings) {
          this.settingsSignal.set(mergeSettings(settings));
        }
      } while (this.refreshQueued);
    } catch {
      // Quiet by design — see the doc comment above.
    } finally {
      this.refreshInFlight = false;
    }
  }

  dismissError(): void {
    this.errorSignal.set(null);
  }

  showMonth(month: MonthKey): void {
    this.selectedMonth.set(month);
  }

  private async persist(
    apply: (current: readonly Transaction[]) => readonly Transaction[],
    write: () => Promise<void>,
    failureMessage: string,
  ): Promise<void> {
    const previous = this.transactionsSignal();
    this.transactionsSignal.set(apply(previous));
    try {
      await write();
      this.errorSignal.set(null);
    } catch (error) {
      this.transactionsSignal.set(previous);
      this.errorSignal.set(describe(error, failureMessage));
    }
  }
}

/** Keeps stored settings forward-compatible when new fields are introduced. */
function mergeSettings(settings: LedgerSettings): LedgerSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    categories: settings.categories?.length ? settings.categories : DEFAULT_SETTINGS.categories,
  };
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? `${fallback} (${error.message})` : fallback;
}
