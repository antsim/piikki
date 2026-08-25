import { MonthKey, monthKeyOf } from './dates';
import { applyShare } from './money';
import { SplitCategory } from './split-category.model';
import { Payer, SplitTerms, Transaction, personalAmountsOf } from './transaction.model';

/** Everything the balance rule needs — a saved transaction or an unsaved draft. */
export type BalanceInput = Pick<Transaction, 'amountCents' | 'payer' | 'split' | 'personal'>;

/**
 * The part of a receipt that actually goes through the split rule: the total
 * minus whatever each of us marked as personal.
 */
export function sharedAmountCents(transaction: BalanceInput): number {
  const amount = Math.abs(transaction.amountCents);
  if (transaction.split.kind === 'settlement') {
    return amount;
  }
  const personal = personalAmountsOf(transaction);
  return Math.max(0, amount - personal.mineCents - personal.partnerCents);
}

/**
 * The single accounting rule of the app.
 *
 * Balance convention: positive = my partner owes me, negative = I owe my partner.
 *
 *  - expense paid by me      -> partner owes me what they were responsible for
 *  - expense paid by partner -> I owe them what I was responsible for
 *  - settlement paid by partner (the usual "pays me back") -> -amount
 *  - settlement paid by me (settling a negative balance)   -> +amount
 *
 * "Responsible for" is a share of the shared part plus your own personal items
 * in full (see `responsibilityCents`). With nothing marked personal that
 * reduces to the plain split it has always been: +amount * (1 - myShare) when
 * I paid, -amount * myShare when my partner did.
 */
export function balanceDeltaCents(transaction: BalanceInput): number {
  const { payer, split } = transaction;

  if (split.kind === 'settlement') {
    const amount = Math.abs(transaction.amountCents);
    return payer === 'me' ? amount : -amount;
  }

  // Whoever paid is owed exactly what the other one was responsible for.
  return payer === 'me'
    ? responsibilityCents(transaction, 'partner')
    : -responsibilityCents(transaction, 'me');
}

/**
 * What one of us is on the hook for in a shared expense: their own personal
 * items in full, plus their share of everything that was left to split.
 *
 * Rounded to whole cents, and deliberately only ever called once per balance
 * calculation — rounding both sides independently would not always add back
 * up to the receipt total.
 */
function responsibilityCents(transaction: BalanceInput, who: Payer): number {
  return (
    ownPersonalCents(transaction, who) +
    applyShare(sharedAmountCents(transaction), shareOf(transaction.split, who))
  );
}

/**
 * `responsibilityCents` without the rounding. A percentage wants the exact
 * proportion — rounding to cents first would report a 1-cent expense as
 * 100 % rather than 60 %.
 */
function exactResponsibilityCents(transaction: BalanceInput, who: Payer): number {
  return (
    ownPersonalCents(transaction, who) +
    sharedAmountCents(transaction) * shareOf(transaction.split, who)
  );
}

function ownPersonalCents(transaction: BalanceInput, who: Payer): number {
  const personal = personalAmountsOf(transaction);
  return who === 'me' ? personal.mineCents : personal.partnerCents;
}

function shareOf(split: SplitTerms, who: Payer): number {
  return who === 'me' ? split.myShare : 1 - split.myShare;
}

/**
 * How much of what the payer fronted the shared ledger has any say over:
 * everything except their own personal items, which never involved the other
 * person at all.
 *
 * This is what the month's "paid by" totals count, so buying your own shampoo
 * on a shared receipt doesn't inflate your side of them.
 */
export function ledgerAmountCents(transaction: BalanceInput): number {
  const amount = Math.abs(transaction.amountCents);
  if (transaction.split.kind === 'settlement') {
    return amount;
  }
  return Math.max(0, amount - ownPersonalCents(transaction, transaction.payer));
}

/**
 * The signed percentage the old spreadsheet used, kept for familiarity:
 * 60 (I paid a household bill), -40 (partner paid one), 50 / -50 (even split),
 * -100 (partner paid me back).
 *
 * Personal items shift it away from the category's own share, since they move
 * responsibility for part of the receipt onto one of us: a 100 € shop split
 * 50/50 with 20 € of my own things in it leaves me carrying 55 % of the total,
 * not 50 %.
 */
export function signedSharePercent(transaction: BalanceInput): number {
  const { payer, split } = transaction;
  if (split.kind === 'settlement') {
    return payer === 'me' ? 100 : -100;
  }

  const amount = Math.abs(transaction.amountCents);
  if (amount === 0) {
    // Nothing to take a proportion of yet — the form asks for the share
    // before the amount, so fall back to the category's own terms.
    return payer === 'me' ? round1(split.myShare * 100) : -round1((1 - split.myShare) * 100);
  }

  return payer === 'me'
    ? round1((exactResponsibilityCents(transaction, 'me') / amount) * 100)
    : -round1((exactResponsibilityCents(transaction, 'partner') / amount) * 100);
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
      paidByMeCents += ledgerAmountCents(transaction);
    } else {
      paidByPartnerCents += ledgerAmountCents(transaction);
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
