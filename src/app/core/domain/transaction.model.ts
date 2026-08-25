import { IsoDate } from './dates';

/** Who actually paid the bill / made the transfer. */
export type Payer = 'me' | 'partner';

export type SplitKind =
  /** A shared cost one of us fronted; the other owes their share of it. */
  | 'expense'
  /** A direct money transfer between us that only settles the balance. */
  | 'settlement';

/**
 * The split terms are copied onto the transaction when it is saved, so changing
 * a category later (e.g. 60/40 -> 55/45) never rewrites past history.
 */
export interface SplitTerms {
  readonly kind: SplitKind;
  /** My responsibility for the cost, 0..1. Ignored for settlements. */
  readonly myShare: number;
}

/**
 * The parts of a receipt that belong to one of us alone — the shampoo on an
 * otherwise 50/50 supermarket run.
 *
 * They are taken off `amountCents` before the split rule is applied, and then
 * charged in full to whoever they belong to. That single rule covers both
 * directions on its own: an item belonging to the person who paid moves the
 * balance not at all (they bought their own thing with their own money),
 * while one belonging to the other person is owed back at 100 % on top of
 * their share of the rest.
 *
 * Only meaningful for `expense` splits; a settlement is never part-personal.
 */
export interface PersonalAmounts {
  /** My own, unshared part of the receipt. */
  readonly mineCents: number;
  /** My partner's own, unshared part. */
  readonly partnerCents: number;
}

export const NO_PERSONAL_AMOUNTS: PersonalAmounts = { mineCents: 0, partnerCents: 0 };

export interface Transaction {
  readonly id: string;
  /** ISO day the purchase happened. Drives which month it belongs to. */
  readonly date: IsoDate;
  /** The place / what it was. */
  readonly description: string;
  /** Always positive; direction comes from `payer` + `split`. */
  readonly amountCents: number;
  readonly payer: Payer;
  readonly categoryId: string;
  readonly split: SplitTerms;
  /** Absent — the common case — when the whole amount was shared. */
  readonly personal?: PersonalAmounts;
  readonly note?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What the form produces, before the store stamps ids and timestamps. */
export interface TransactionDraft {
  readonly date: IsoDate;
  readonly description: string;
  readonly amountCents: number;
  readonly payer: Payer;
  readonly categoryId: string;
  readonly split: SplitTerms;
  readonly personal?: PersonalAmounts;
  readonly note?: string;
}

/** Saves every caller from branching on the optional field. */
export function personalAmountsOf(transaction: {
  readonly personal?: PersonalAmounts;
}): PersonalAmounts {
  return transaction.personal ?? NO_PERSONAL_AMOUNTS;
}

/**
 * Coerces personal amounts into something the accounting rule can trust:
 * whole non-negative cents that never add up to more than the receipt did.
 *
 * The form already stops you entering more than the total, so this is the
 * boundary guard for everything that doesn't go through it — a restored
 * backup, a row written by an older client, a hand-edited database. Values
 * over the total are clamped rather than rejected so one bad figure can't
 * cost you a whole import; `mineCents` is filled first and the partner's
 * share takes whatever is left.
 *
 * Returns `undefined` when nothing personal remains, so the common case
 * keeps the field off the object entirely.
 */
export function normalisePersonalAmounts(
  personal: PersonalAmounts | undefined,
  amountCents: number,
): PersonalAmounts | undefined {
  if (!personal) {
    return undefined;
  }
  const total = Math.round(Math.abs(amountCents));
  const mineCents = clampCents(personal.mineCents, total);
  const partnerCents = clampCents(personal.partnerCents, total - mineCents);
  return mineCents || partnerCents ? { mineCents, partnerCents } : undefined;
}

function clampCents(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Math.round(value), Math.max(0, max));
}
