import { SplitKind } from './transaction.model';

/** A reusable split rule shown as a chip in the add form. */
export interface SplitCategory {
  readonly id: string;
  readonly label: string;
  readonly kind: SplitKind;
  /** My responsibility for the cost, 0..1. Ignored for settlements. */
  readonly myShare: number;
  /** Categories are archived rather than deleted so history keeps its label. */
  readonly archived?: boolean;
}

export const HOUSEHOLD_CATEGORY_ID = 'household';
export const SHARED_CATEGORY_ID = 'shared';
export const SETTLEMENT_CATEGORY_ID = 'settlement';
/**
 * A one-time entry for carrying a balance in from wherever you tracked this
 * before (a spreadsheet, say). Uses the exact same `settlement` math as a
 * real settlement — `payer` just means "who the starting balance favors"
 * instead of "who sent the money" — so there is no separate balance rule to
 * get wrong; only the wording in the form differs. See TransactionForm and
 * LedgerStore.hasOpeningBalance.
 */
export const OPENING_BALANCE_CATEGORY_ID = 'opening-balance';

export const DEFAULT_CATEGORIES: readonly SplitCategory[] = [
  { id: HOUSEHOLD_CATEGORY_ID, label: 'Household', kind: 'expense', myShare: 0.6 },
  { id: SHARED_CATEGORY_ID, label: 'Shared 50/50', kind: 'expense', myShare: 0.5 },
  { id: SETTLEMENT_CATEGORY_ID, label: 'Settlement', kind: 'settlement', myShare: 0 },
  { id: OPENING_BALANCE_CATEGORY_ID, label: 'Opening balance', kind: 'settlement', myShare: 0 },
];

export function findCategory(
  categories: readonly SplitCategory[],
  id: string,
): SplitCategory | undefined {
  return categories.find((category) => category.id === id);
}
