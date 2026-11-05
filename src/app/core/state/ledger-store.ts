import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { AuthStore } from '../auth/auth.store';
import { currentMonthKey, MonthKey } from '../domain/dates';
import { buildEntries, buildMonthSummary, listMonths, totalBalanceCents } from '../domain/ledger';
import { DEFAULT_SETTINGS, LedgerSettings } from '../domain/settings.model';
import { LedgerSnapshot } from '../domain/snapshot.model';
import { OPENING_BALANCE_CATEGORY_ID, SplitCategory } from '../domain/split-category.model';
import {
  normalisePersonalAmounts,
  Transaction,
  TransactionDraft,
} from '../domain/transaction.model';
import { LedgerStorage, PersistedLedger } from '../storage/ledger-storage';

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
  private readonly auth = inject(AuthStore);

  private readonly transactionsSignal = signal<readonly Transaction[]>([]);
  private readonly settingsSignal = signal<LedgerSettings>(DEFAULT_SETTINGS);
  private readonly statusSignal = signal<LedgerStatus>('loading');
  private readonly errorSignal = signal<string | null>(null);
  private readonly pendingSyncCountSignal = signal(0);
  private readonly refreshingSignal = signal(false);

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
  /** Writes made offline that haven't reached the cloud backend yet. Always 0 locally. */
  readonly pendingSyncCount = this.pendingSyncCountSignal.asReadonly();
  /**
   * True while the startup load is fetching fresh data in the background
   * behind already-visible cached data. The UI shows a small, non-blocking
   * hint for it; `status` stays 'ready' throughout.
   */
  readonly refreshing = this.refreshingSignal.asReadonly();

  private refreshInFlight = false;
  private refreshQueued = false;
  private hasLoadedOnce = false;

  /**
   * Bookkeeping for the race between a background fetch and the user's own
   * writes: a fetch that was issued before a write reached the backend
   * returns data without that write, and applying it would make the
   * optimistic change briefly vanish. See fetchFresh().
   */
  private writesInFlight = 0;
  private writeEpoch = 0;
  private refreshAfterWrites = false;

  constructor() {
    // A cloud backend calls this when the *other* device writes something,
    // or when our own queued offline writes have just been replayed; local
    // adapters never fire it.
    this.storage.onRemoteChange(() => void this.refreshFromRemote());
    this.storage.onPendingSyncChange((count) => this.pendingSyncCountSignal.set(count));

    // Local mode is "ready" immediately; cloud mode has to wait for a sign-in
    // that might not happen until after this component tree has already
    // rendered a login screen. Rather than the app-bootstrap code deciding
    // when to call load(), LedgerStore watches the gate itself and loads the
    // moment it opens — bootstrap can await it when the gate is already open
    // (see app.config.ts) and simply not await it otherwise.
    effect(() => {
      if (this.auth.readyToLoad() && !this.hasLoadedOnce) {
        void this.load();
      }
    });
  }

  readonly categories = computed(() => this.settingsSignal().categories);
  readonly selectableCategories = computed(() =>
    this.categories().filter((category) => !category.archived),
  );

  /**
   * True once an opening-balance entry exists. There should only ever be one
   * — the form uses this to stop offering the chip after the first save,
   * rather than hard-blocking a second one (deleting the first un-hides it).
   */
  readonly hasOpeningBalance = computed(() =>
    this.transactionsSignal().some(
      (transaction) => transaction.categoryId === OPENING_BALANCE_CATEGORY_ID,
    ),
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

  /**
   * Stale-while-revalidate: if the adapter has a cached copy (cloud mode's
   * IndexedDB snapshot), show it straight away and mark the store ready, then
   * fetch the fresh copy in the background and swap it in. Without a cache
   * (first visit on a device, or local mode where load() is already local)
   * the status stays 'loading' until the real load finishes.
   */
  async load(): Promise<void> {
    this.hasLoadedOnce = true;
    const showedCache = await this.showCached();
    if (!showedCache) {
      this.statusSignal.set('loading');
    }
    this.refreshingSignal.set(showedCache);
    try {
      const fresh = await this.fetchFresh();
      if (fresh) {
        this.applyLoaded(fresh);
      } else {
        this.requestRefresh();
      }
      this.statusSignal.set('ready');
      this.errorSignal.set(null);
    } catch (error) {
      if (!showedCache) {
        this.statusSignal.set('error');
      }
      const fallback =
        this.backend === 'cloud'
          ? 'Could not reach the cloud database.'
          : 'Could not open local storage.';
      this.errorSignal.set(describe(error, fallback));
    } finally {
      this.refreshingSignal.set(false);
    }
  }

  private async showCached(): Promise<boolean> {
    let cached: PersistedLedger | null = null;
    try {
      cached = await this.storage.loadCached();
    } catch {
      // A broken cache only costs us the fast path; the real load follows.
    }
    if (!cached || this.statusSignal() === 'ready') {
      return false;
    }
    this.applyLoaded(cached);
    this.statusSignal.set('ready');
    return true;
  }

  private applyLoaded({ transactions, settings }: PersistedLedger): void {
    this.transactionsSignal.set(transactions);
    this.settingsSignal.set(settings ? mergeSettings(settings) : DEFAULT_SETTINGS);
  }

  /**
   * storage.load(), but resolves to null when one of our own writes overlapped
   * the fetch — the result may predate that write, so applying it would undo
   * the optimistic update on screen. Callers then ask for another refresh
   * once the writes have settled (requestRefresh()).
   */
  private async fetchFresh(): Promise<PersistedLedger | null> {
    const epoch = this.writeEpoch;
    const busyAtStart = this.writesInFlight > 0;
    const result = await this.storage.load();
    const overlapped = busyAtStart || this.writesInFlight > 0 || epoch !== this.writeEpoch;
    return overlapped ? null : result;
  }

  private requestRefresh(): void {
    if (this.writesInFlight > 0) {
      this.refreshAfterWrites = true;
    } else {
      void this.refreshFromRemote();
    }
  }

  /** Runs a storage write while recording it for fetchFresh()'s overlap check. */
  private async trackWrite<T>(write: () => Promise<T>): Promise<T> {
    this.writesInFlight++;
    try {
      return await write();
    } finally {
      this.writesInFlight--;
      this.writeEpoch++;
      if (this.writesInFlight === 0 && this.refreshAfterWrites) {
        this.refreshAfterWrites = false;
        void this.refreshFromRemote();
      }
    }
  }

  async addTransaction(draft: TransactionDraft): Promise<Transaction> {
    const now = new Date().toISOString();
    const amountCents = Math.round(Math.abs(draft.amountCents));
    const transaction: Transaction = {
      ...draft,
      description: draft.description.trim(),
      amountCents,
      personal: normalisePersonalAmounts(draft.personal, amountCents),
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
    const amountCents = Math.round(Math.abs(draft.amountCents));
    const updated: Transaction = {
      ...existing,
      ...draft,
      description: draft.description.trim(),
      amountCents,
      // Set explicitly rather than left to the spread: clearing every personal
      // item has to actually drop the old ones, not inherit them from `existing`.
      personal: normalisePersonalAmounts(draft.personal, amountCents),
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
      await this.trackWrite(() => this.storage.putSettings(next));
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
      await this.trackWrite(() => this.storage.replaceAll(snapshot.transactions, settings));
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
      await this.trackWrite(() => this.storage.replaceAll([], settings));
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
        const fresh = await this.fetchFresh();
        if (!fresh) {
          // Sets refreshQueued (loop again) or defers until writes settle.
          this.requestRefresh();
          continue;
        }
        this.transactionsSignal.set(fresh.transactions);
        if (fresh.settings) {
          this.settingsSignal.set(mergeSettings(fresh.settings));
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
      await this.trackWrite(write);
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
