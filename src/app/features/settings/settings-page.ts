import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BackupService } from '../../core/backup/backup.service';
import { SplitCategory } from '../../core/domain/split-category.model';
import { MoneyFormatter } from '../../core/format/money-formatter';
import { LedgerStore } from '../../core/state/ledger-store';
import { ToastStore } from '../../core/state/toast-store';

@Component({
  selector: 'app-settings-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  protected readonly store = inject(LedgerStore);
  protected readonly backup = inject(BackupService);
  protected readonly money = inject(MoneyFormatter);
  private readonly toasts = inject(ToastStore);

  protected readonly importError = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected async renameMe(value: string): Promise<void> {
    await this.store.updateSettings({ myName: value.trim() || 'Me' });
  }

  protected async renamePartner(value: string): Promise<void> {
    await this.store.updateSettings({ partnerName: value.trim() || 'Partner' });
  }

  protected async setCurrency(value: string): Promise<void> {
    const currency = value.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(currency)) {
      await this.store.updateSettings({ currency });
    }
  }

  protected async setLocale(value: string): Promise<void> {
    await this.store.updateSettings({ locale: value.trim() || 'fi-FI' });
  }

  protected async renameCategory(category: SplitCategory, label: string): Promise<void> {
    await this.store.saveCategory({ ...category, label: label.trim() || category.label });
  }

  /**
   * Changing a share only affects transactions added afterwards — saved rows keep
   * the terms they were entered with, exactly like the old spreadsheet rows did.
   */
  protected async setShare(category: SplitCategory, percent: string): Promise<void> {
    const value = Number(percent);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return;
    }
    await this.store.saveCategory({ ...category, myShare: Math.round(value) / 100 });
  }

  protected async toggleArchived(category: SplitCategory): Promise<void> {
    await this.store.saveCategory({ ...category, archived: !category.archived });
  }

  protected async addCategory(): Promise<void> {
    await this.store.saveCategory({
      id: crypto.randomUUID(),
      label: 'New rule',
      kind: 'expense',
      myShare: 0.5,
    });
  }

  protected async setDefaultCategory(id: string): Promise<void> {
    await this.store.updateSettings({ defaultCategoryId: id });
  }

  protected async exportBackup(): Promise<void> {
    await this.backup.export();
    this.toasts.show('Backup downloaded');
  }

  protected async importBackup(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.importError.set(null);
    this.busy.set(true);
    try {
      const count = await this.backup.import(file);
      this.toasts.show(`Imported ${count} ${count === 1 ? 'transaction' : 'transactions'}`);
    } catch (error) {
      this.importError.set(error instanceof Error ? error.message : 'Could not read that file.');
    } finally {
      this.busy.set(false);
      input.value = '';
    }
  }

  protected async clearAll(): Promise<void> {
    const count = this.store.transactions().length;
    const confirmed = confirm(
      `Delete all ${count} transactions? Export a backup first — this cannot be undone.`,
    );
    if (confirmed) {
      await this.store.clearTransactions();
      this.toasts.show('All transactions deleted');
    }
  }

  protected readValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected percentOf(category: SplitCategory): number {
    return Math.round(category.myShare * 100);
  }
}
