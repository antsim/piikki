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

export const DEFAULT_CATEGORIES: readonly SplitCategory[] = [
  { id: HOUSEHOLD_CATEGORY_ID, label: 'Household', kind: 'expense', myShare: 0.6 },
  { id: SHARED_CATEGORY_ID, label: 'Shared 50/50', kind: 'expense', myShare: 0.5 },
  { id: SETTLEMENT_CATEGORY_ID, label: 'Settlement', kind: 'settlement', myShare: 0 },
];

export function findCategory(
  categories: readonly SplitCategory[],
  id: string,
): SplitCategory | undefined {
  return categories.find((category) => category.id === id);
}
