import { DEFAULT_CATEGORIES, HOUSEHOLD_CATEGORY_ID, SplitCategory } from './split-category.model';

export interface LedgerSettings {
  /** Display name for the app owner (the person using the app). */
  readonly myName: string;
  /** Display name for the other person. */
  readonly partnerName: string;
  readonly currency: string;
  readonly locale: string;
  readonly categories: readonly SplitCategory[];
  readonly defaultCategoryId: string;
  /** ISO timestamp of the last JSON backup export, for the reminder banner. */
  readonly lastExportAt?: string;
}

export const DEFAULT_SETTINGS: LedgerSettings = {
  myName: 'Me',
  partnerName: 'Wife',
  currency: 'EUR',
  locale: 'fi-FI',
  categories: DEFAULT_CATEGORIES,
  defaultCategoryId: HOUSEHOLD_CATEGORY_ID,
};
