import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { dayLabel, monthLabel } from '../../core/domain/dates';
import { LedgerEntry } from '../../core/domain/ledger';
import { OPENING_BALANCE_CATEGORY_ID } from '../../core/domain/split-category.model';
import { personalAmountsOf, Transaction } from '../../core/domain/transaction.model';
import { BackupService } from '../../core/backup/backup.service';
import { MoneyFormatter } from '../../core/format/money-formatter';
import { ConnectivityStore } from '../../core/state/connectivity-store';
import { LedgerStore } from '../../core/state/ledger-store';
import { categoryIcon } from '../../shared/ui/category-icon';
import { TransactionForm, TransactionFormRequest } from '../transaction-form/transaction-form';
import { BalanceSummary } from './components/balance-summary';
import { MonthSwitcher } from './components/month-switcher';

interface DayGroup {
  readonly date: string;
  readonly label: string;
  readonly entries: readonly LedgerEntry[];
}

@Component({
  selector: 'app-ledger-page',
  imports: [RouterLink, BalanceSummary, MonthSwitcher, TransactionForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ledger-page.html',
  styleUrl: './ledger-page.scss',
})
export class LedgerPage {
  protected readonly store = inject(LedgerStore);
  protected readonly money = inject(MoneyFormatter);
  protected readonly backup = inject(BackupService);
  protected readonly connectivity = inject(ConnectivityStore);

  /** Non-null while the add/edit dialog is open. */
  protected readonly formRequest = signal<TransactionFormRequest | null>(null);

  protected readonly summary = this.store.monthSummary;
  protected readonly monthName = computed(() => monthLabel(this.summary().month));

  /** Entries of the selected month, bucketed by day for the list headers. */
  protected readonly days = computed<DayGroup[]>(() => {
    const groups = new Map<string, LedgerEntry[]>();
    for (const entry of this.summary().entries) {
      const bucket = groups.get(entry.transaction.date);
      if (bucket) {
        bucket.push(entry);
      } else {
        groups.set(entry.transaction.date, [entry]);
      }
    }
    return [...groups.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, entries]) => ({
        date,
        label: dayLabel(date),
        entries: [...entries].reverse(),
      }));
  });

  protected add(): void {
    this.formRequest.set({});
  }

  protected edit(transaction: Transaction): void {
    this.formRequest.set({ transaction });
  }

  /** Pre-fills a settlement for the whole outstanding balance, in the right direction. */
  protected settleUp(): void {
    const balance = this.store.balanceCents();
    const categories = this.store.selectableCategories();
    const settlement = categories.find((category) => category.kind === 'settlement');
    this.formRequest.set({
      prefill: {
        amountCents: Math.abs(balance),
        payer: balance > 0 ? 'partner' : 'me',
        categoryId: settlement?.id ?? categories[0]?.id,
        description: settlement?.label ?? 'Settlement',
      },
    });
  }

  protected icon(entry: LedgerEntry): string {
    return categoryIcon(entry.category);
  }

  /** The "Household · paid by Wife · -40 %" line under each row. */
  protected meta(entry: LedgerEntry): string {
    const { myName, partnerName } = this.store.settings();
    const { payer, split, categoryId } = entry.transaction;

    if (categoryId === OPENING_BALANCE_CATEGORY_ID) {
      return payer === 'me' ? `Carried in — favors ${myName}` : `Carried in — favors ${partnerName}`;
    }

    if (split.kind === 'settlement') {
      return payer === 'me' ? `Payment to ${partnerName}` : `Payment from ${partnerName}`;
    }

    const who = payer === 'me' ? myName : partnerName;
    const label = entry.category?.label ?? 'Uncategorised';
    const parts = [label, `paid by ${who}`, this.money.percent(entry.percent)];

    // Without this the row looks like a plain 50/50 whose percentage is wrong.
    const personal = personalAmountsOf(entry.transaction);
    const personalCents = personal.mineCents + personal.partnerCents;
    if (personalCents > 0) {
      parts.push(`${this.money.format(personalCents)} personal`);
    }

    return parts.join(' · ');
  }
}
