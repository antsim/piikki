import {
  HOUSEHOLD_CATEGORY_ID,
  OPENING_BALANCE_CATEGORY_ID,
  SETTLEMENT_CATEGORY_ID,
  SHARED_CATEGORY_ID,
  SplitCategory,
} from '../../core/domain/split-category.model';

/**
 * Purely presentational — an emoji badge per category, so the ledger and the
 * type picker read at a glance instead of as a wall of text. The four
 * built-in categories get a specific icon; anything a user adds falls back
 * to a generic one keyed off its kind, since custom categories don't have a
 * fixed id to match on.
 */
const ICONS_BY_ID: Readonly<Record<string, string>> = {
  [HOUSEHOLD_CATEGORY_ID]: '🏠',
  [SHARED_CATEGORY_ID]: '🧾',
  [SETTLEMENT_CATEGORY_ID]: '🔄',
  [OPENING_BALANCE_CATEGORY_ID]: '📥',
};

export function categoryIcon(category: SplitCategory | undefined): string {
  if (!category) {
    return '❔';
  }
  return ICONS_BY_ID[category.id] ?? (category.kind === 'settlement' ? '🔄' : '💳');
}
