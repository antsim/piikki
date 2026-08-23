import { computed, inject, Injectable } from '@angular/core';
import { formatCents } from '../domain/money';
import { LedgerStore } from '../state/ledger-store';

/**
 * Formatting helpers bound to the user's currency/locale settings.
 * Exposed as a service rather than a pipe so templates always see fresh values
 * when the settings signal changes.
 */
@Injectable({ providedIn: 'root' })
export class MoneyFormatter {
  private readonly settings = inject(LedgerStore).settings;

  private readonly options = computed(() => ({
    locale: this.settings().locale,
    currency: this.settings().currency,
  }));

  /** 1234,56 € */
  format(cents: number): string {
    return formatCents(cents, this.options());
  }

  /** +1234,56 € / −1234,56 € — for balance deltas. */
  signed(cents: number): string {
    return formatCents(cents, { ...this.options(), signed: true });
  }

  /** Absolute value, for "owes you X" phrasings where the sign is in the words. */
  absolute(cents: number): string {
    return formatCents(Math.abs(cents), this.options());
  }

  /** The spreadsheet-style share column: 60 %, -40 %, -100 %. */
  percent(value: number): string {
    return `${value > 0 ? '' : '−'}${Math.abs(value)} %`;
  }
}
