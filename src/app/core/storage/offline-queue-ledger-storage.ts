import { LedgerSettings } from '../domain/settings.model';
import { Transaction } from '../domain/transaction.model';
import { LedgerStorage, PersistedLedger, StorageBackend } from './ledger-storage';
import { applyOutbox, foldOutboxEntry, OfflineStore, OutboxOperation } from './offline-outbox';

/**
 * Wraps a remote LedgerStorage (Supabase, today) so the app keeps working
 * while offline:
 *
 *  - reads fall back to the last successfully loaded snapshot instead of a
 *    blank error screen, with any not-yet-synced writes of your own
 *    re-applied on top so a reload doesn't lose them;
 *  - writes that fail because there's no connection are queued instead of
 *    rolled back — LedgerStore's optimistic UI update simply stands;
 *  - the queue replays automatically once the browser fires an `online`
 *    event, and a successful (even partial) replay tells the ledger to
 *    refresh, the same way it would if the partner's device had written
 *    something — which, by then, it may well have.
 *
 * Only used for the cloud backend — see ledger-storage.provider.ts. Local
 * storage has nothing to be "offline" from.
 */
export class OfflineQueueLedgerStorage extends LedgerStorage {
  override readonly durable: boolean;
  override readonly backend: StorageBackend;

  private readonly remoteListeners = new Set<() => void>();
  private readonly pendingListeners = new Set<(count: number) => void>();
  private pendingCount = 0;
  private flushPromise: Promise<void> | null = null;

  constructor(
    private readonly inner: LedgerStorage,
    private readonly store: OfflineStore,
  ) {
    super();
    this.durable = inner.durable;
    this.backend = inner.backend;
    void this.refreshPendingCount();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.flush());
    }
    // A previous session may have left writes queued; if we're already
    // online, don't wait for an 'online' event that will never fire.
    void this.flush();
  }

  async load(): Promise<PersistedLedger> {
    try {
      const fresh = await this.inner.load();
      await this.store.writeCache(fresh);
      return this.withPending(fresh);
    } catch (error) {
      const cached = await this.store.readCache();
      if (!cached) {
        throw error;
      }
      return this.withPending(cached);
    }
  }

  async putTransaction(transaction: Transaction): Promise<void> {
    await this.write(() => this.inner.putTransaction(transaction), {
      kind: 'putTransaction',
      transaction,
    });
  }

  async deleteTransaction(id: string): Promise<void> {
    await this.write(() => this.inner.deleteTransaction(id), { kind: 'deleteTransaction', id });
  }

  async putSettings(settings: LedgerSettings): Promise<void> {
    await this.write(() => this.inner.putSettings(settings), { kind: 'putSettings', settings });
  }

  /**
   * Bulk replace (backup import, "start over") is deliberately not queued —
   * see SupabaseLedgerStorage.replaceAll's own note on why it's already a
   * non-atomic, explicit, rare action. Reconciling a whole-ledger swap
   * against whatever else happened while offline is a lot more likely to go
   * wrong than replaying individual row writes, so this simply requires a
   * connection, same as before this wrapper existed.
   */
  async replaceAll(transactions: readonly Transaction[], settings: LedgerSettings): Promise<void> {
    await this.inner.replaceAll(transactions, settings);
    await this.store.writeCache({ transactions, settings });
  }

  override onRemoteChange(listener: () => void): () => void {
    this.remoteListeners.add(listener);
    const unsubscribe = this.inner.onRemoteChange(listener);
    return () => {
      this.remoteListeners.delete(listener);
      unsubscribe();
    };
  }

  override pendingSyncCount(): number {
    return this.pendingCount;
  }

  override onPendingSyncChange(listener: (count: number) => void): () => void {
    this.pendingListeners.add(listener);
    listener(this.pendingCount);
    return () => this.pendingListeners.delete(listener);
  }

  private async write(send: () => Promise<void>, operation: OutboxOperation): Promise<void> {
    try {
      await send();
    } catch (error) {
      if (!isOfflineError(error)) {
        throw error;
      }
      await this.store.putOutboxEntry(foldOutboxEntry(operation));
      await this.refreshPendingCount();
    }
  }

  private async withPending(ledger: PersistedLedger): Promise<PersistedLedger> {
    const entries = await this.store.listOutbox();
    this.setPendingCount(entries.length);
    return applyOutbox(ledger, entries);
  }

  private async refreshPendingCount(): Promise<void> {
    this.setPendingCount((await this.store.listOutbox()).length);
  }

  private setPendingCount(count: number): void {
    this.pendingCount = count;
    for (const listener of this.pendingListeners) {
      listener(count);
    }
  }

  /**
   * Replays queued writes in order, oldest first. Stops at the first
   * failure — offline again, or the same write fails a second time — and
   * leaves whatever's left queued for the next attempt. A failure that
   * turns out not to be connectivity (an expired session, say) isn't
   * distinguished from one that is: there's no user watching a background
   * retry to show an error to, and the next write the user actually makes
   * will hit — and surface — the same problem through the normal path.
   */
  private flush(): Promise<void> {
    this.flushPromise ??= this.runFlush().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  private async runFlush(): Promise<void> {
    const entries = await this.store.listOutbox();
    let flushedAny = false;
    for (const entry of entries) {
      try {
        await this.replay(entry.operation);
        await this.store.removeOutboxEntry(entry.key);
        flushedAny = true;
      } catch {
        break;
      }
    }
    await this.refreshPendingCount();
    if (flushedAny) {
      for (const listener of this.remoteListeners) {
        listener();
      }
    }
  }

  private replay(operation: OutboxOperation): Promise<void> {
    switch (operation.kind) {
      case 'putTransaction':
        return this.inner.putTransaction(operation.transaction);
      case 'deleteTransaction':
        return this.inner.deleteTransaction(operation.id);
      case 'putSettings':
        return this.inner.putSettings(operation.settings);
    }
  }
}

/**
 * Best-effort "was that failure because we're offline?" check. There is no
 * fully reliable signal for this on the web:
 *  - `navigator.onLine` is trustworthy when it says `false` (no network
 *    interface up at all) but can still say `true` on a connection that
 *    can't actually reach anything (a captive portal, say).
 *  - a `fetch()` rejects with a plain `TypeError` for any network-level
 *    failure, which is how the Supabase client's own request failures
 *    surface here.
 * Between the two, real errors (a rejected constraint, an expired session)
 * still read as `false` and get surfaced immediately instead of silently
 * queued — see the `write()` caller.
 */
function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|load failed|network|err_internet|err_connection/i.test(message);
}
