import { MonthKey, monthKeyOf } from './dates';
import { applyShare } from './money';
import { SplitCategory } from './split-category.model';
import { Transaction } from './transaction.model';

/** Everything the balance rule needs — a saved transaction or an unsaved draft. */
export type BalanceInput = Pick<Transaction, 'amountCents' | 'payer' | 'split'>;

/**
 * The single accounting rule of the app.
 *
 * Balance convention: positive = my partner owes me, negative = I owe my partner.
 *
 *  - expense paid by me      -> partner owes me their share      -> +amount * (1 - myShare)
 *  - expense paid by partner -> I owe them my share              -> -amount * myShare
 *  - settlement paid by partner (the usual "pays me back") -> -amount
 *  - settlement paid by me (settling a negative balance)   -> +amount
 */
export function balanceDeltaCents(transaction: BalanceInput): number {
  const { amountCents, payer, split } = transaction;
  const amount = Math.abs(amountCents);

  if (split.kind === 'settlement') {
    return payer === 'me' ? amount : -amount;
  }

  const share = payer === 'me' ? 1 - split.myShare : split.myShare;
  const magnitude = applyShare(amount, share);
  return payer === 'me' ? magnitude : -magnitude;
}

/**
 * The signed percentage the old spreadsheet used, kept for familiarity:
 * 60 (I paid a household bill), -40 (partner paid one), 50 / -50 (even split),
 * -100 (partner paid me back).
 */
export function signedSharePercent(transaction: Pick<Transaction, 'payer' | 'split'>): number {
  const { payer, split } = transaction;
  if (split.kind === 'settlement') {
    return payer === 'me' ? 100 : -100;
  }
  return payer === 'me'
    ? round1(split.myShare * 100)
    : -round1((1 - split.myShare) * 100);
}

/** Chronological order: by day, then by insertion time so same-day rows stay stable. */
export function compareTransactions(a: Transaction, b: Transaction): number {
  return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function sortChronologically(transactions: readonly Transaction[]): Transaction[] {
  return [...transactions].sort(compareTransactions);
}

/** A transaction plus everything the UI wants to show next to it. */
export interface LedgerEntry {
  readonly transaction: Transaction;
  readonly category: SplitCategory | undefined;
  readonly deltaCents: number;
  readonly percent: number;
  /** Running balance after this transaction. */
  readonly balanceAfterCents: number;
}

export function buildEntries(
  transactions: readonly Transaction[],
  categories: readonly SplitCategory[],
): LedgerEntry[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  let running = 0;
  return sortChronologically(transactions).map((transaction) => {
    const deltaCents = balanceDeltaCents(transaction);
    running += deltaCents;
    return {
      transaction,
      category: categoryById.get(transaction.categoryId),
      deltaCents,
      percent: signedSharePercent(transaction),
      balanceAfterCents: running,
    };
  });
}

export function totalBalanceCents(transactions: readonly Transaction[]): number {
  return transactions.reduce((sum, transaction) => sum + balanceDeltaCents(transaction), 0);
}

export interface MonthSummary {
  readonly month: MonthKey;
  /** Carried over from every earlier month — the spreadsheet's "previous balance" row. */
  readonly openingCents: number;
  readonly closingCents: number;
  /** What happened inside the month, chronological. */
  readonly entries: readonly LedgerEntry[];
  readonly paidByMeCents: number;
  readonly paidByPartnerCents: number;
  readonly settledCents: number;
}

/** Slices the running ledger into one month, carrying the balance in from the past. */
export function buildMonthSummary(
  entries: readonly LedgerEntry[],
  month: MonthKey,
): MonthSummary {
  const inMonth: LedgerEntry[] = [];
  let openingCents = 0;

  for (const entry of entries) {
    const entryMonth = monthKeyOf(entry.transaction.date);
    if (entryMonth < month) {
      openingCents = entry.balanceAfterCents;
    } else if (entryMonth === month) {
      inMonth.push(entry);
    }
  }

  const closingCents = inMonth.length
    ? inMonth[inMonth.length - 1].balanceAfterCents
    : openingCents;

  let paidByMeCents = 0;
  let paidByPartnerCents = 0;
  let settledCents = 0;

  for (const { transaction } of inMonth) {
    if (transaction.split.kind === 'settlement') {
      settledCents += transaction.amountCents;
    } else if (transaction.payer === 'me') {
      paidByMeCents += transaction.amountCents;
    } else {
      paidByPartnerCents += transaction.amountCents;
    }
  }

  return { month, openingCents, closingCents, entries: inMonth, paidByMeCents, paidByPartnerCents, settledCents };
}

/** Every month that has activity, newest first, always including `alwaysInclude`. */
export function listMonths(
  transactions: readonly Transaction[],
  alwaysInclude: MonthKey,
): MonthKey[] {
  const months = new Set<MonthKey>([alwaysInclude]);
  for (const transaction of transactions) {
    months.add(monthKeyOf(transaction.date));
  }
  return [...months].sort().reverse();
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
