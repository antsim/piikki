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
  readonly note?: string;
}
