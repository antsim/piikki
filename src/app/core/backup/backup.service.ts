import { computed, inject, Injectable } from '@angular/core';
import { createSnapshot, parseSnapshot, SnapshotParseError } from '../domain/snapshot.model';
import { LedgerStore } from '../state/ledger-store';

const REMIND_AFTER_DAYS = 30;
/** Nothing worth nagging about until there is a bit of history to lose. */
const REMIND_AFTER_TRANSACTIONS = 10;

/**
 * The app has no server, so a JSON file is the escape hatch: it is the backup,
 * the device-to-device transfer and the archive format all at once.
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly store = inject(LedgerStore);

  readonly lastExportAt = computed(() => this.store.settings().lastExportAt ?? null);

  /** True once the data is old enough that a fresh backup is worth nagging about. */
  readonly backupOverdue = computed(() => {
    const last = this.lastExportAt();
    if (!last) {
      return this.store.transactions().length >= REMIND_AFTER_TRANSACTIONS;
    }
    if (!this.store.transactions().length) {
      return false;
    }
    const age = Date.now() - new Date(last).getTime();
    return age > REMIND_AFTER_DAYS * 24 * 60 * 60 * 1000;
  });

  async export(): Promise<void> {
    const snapshot = createSnapshot(this.store.transactions(), this.store.settings());
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `piikki-backup-${snapshot.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    await this.store.updateSettings({ lastExportAt: snapshot.exportedAt });
  }

  /** Reads a backup file and replaces the ledger with it. */
  async import(file: File): Promise<number> {
    let snapshot;
    try {
      snapshot = parseSnapshot(JSON.parse(await file.text()));
    } catch (error) {
      throw error instanceof SnapshotParseError
        ? error
        : new SnapshotParseError('That file is not valid JSON.');
    }
    await this.store.importSnapshot(snapshot);
    return snapshot.transactions.length;
  }
}
