/**
 * Pure mapping between the domain model and Supabase's row shape (snake_case
 * columns, JSON-safe values). Kept separate from `SupabaseLedgerStorage` so
 * the mapping logic — the part most likely to have an off-by-one or a typo —
 * is testable without a network connection or a mocked client.
 */
import { isValidIsoDate } from '../domain/dates';
import { DEFAULT_SETTINGS, LedgerSettings } from '../domain/settings.model';
import { SplitCategory } from '../domain/split-category.model';
import {
  normalisePersonalAmounts,
  Payer,
  personalAmountsOf,
  SplitKind,
  Transaction,
} from '../domain/transaction.model';

/** Fixed primary key: the settings table only ever holds one row. */
export const SETTINGS_ROW_ID = 'singleton';

export interface TransactionRow {
  readonly id: string;
  readonly date: string;
  readonly description: string;
  readonly amount_cents: number;
  readonly payer: string;
  readonly category_id: string;
  readonly split_kind: string;
  readonly split_my_share: number;
  /**
   * Optional in the type, not in the schema: a project whose `transactions`
   * table predates personal items simply won't return these columns, and a
   * missing column should read as "nothing personal" rather than crash the
   * whole load. Writing still needs the columns — see supabase/schema.sql.
   */
  readonly personal_mine_cents?: number | null;
  readonly personal_partner_cents?: number | null;
  readonly note: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SettingsRow {
  readonly id: string;
  readonly my_name: string;
  readonly partner_name: string;
  readonly currency: string;
  readonly locale: string;
  readonly categories: unknown;
  readonly default_category_id: string;
  readonly last_export_at: string | null;
}

export function transactionToRow(transaction: Transaction): TransactionRow {
  return {
    id: transaction.id,
    date: transaction.date,
    description: transaction.description,
    amount_cents: transaction.amountCents,
    payer: transaction.payer,
    category_id: transaction.categoryId,
    split_kind: transaction.split.kind,
    split_my_share: transaction.split.myShare,
    personal_mine_cents: personalAmountsOf(transaction).mineCents,
    personal_partner_cents: personalAmountsOf(transaction).partnerCents,
    note: transaction.note ?? null,
    created_at: transaction.createdAt,
    updated_at: transaction.updatedAt,
  };
}

/** Throws on a row that doesn't look like a transaction — better than silently dropping it. */
export function rowToTransaction(row: TransactionRow): Transaction {
  if (!isValidIsoDate(row.date)) {
    throw new Error(`Transaction ${row.id} has an invalid date.`);
  }
  if (row.payer !== 'me' && row.payer !== 'partner') {
    throw new Error(`Transaction ${row.id} has an invalid payer.`);
  }
  if (row.split_kind !== 'expense' && row.split_kind !== 'settlement') {
    throw new Error(`Transaction ${row.id} has an invalid split kind.`);
  }
  const amountCents = Math.round(Math.abs(row.amount_cents));
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    amountCents,
    payer: row.payer as Payer,
    categoryId: row.category_id,
    split: { kind: row.split_kind as SplitKind, myShare: row.split_my_share },
    personal: normalisePersonalAmounts(
      {
        mineCents: row.personal_mine_cents ?? 0,
        partnerCents: row.personal_partner_cents ?? 0,
      },
      amountCents,
    ),
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function settingsToRow(settings: LedgerSettings): SettingsRow {
  return {
    id: SETTINGS_ROW_ID,
    my_name: settings.myName,
    partner_name: settings.partnerName,
    currency: settings.currency,
    locale: settings.locale,
    categories: settings.categories as unknown,
    default_category_id: settings.defaultCategoryId,
    last_export_at: settings.lastExportAt ?? null,
  };
}

export function rowToSettings(row: SettingsRow): LedgerSettings {
  const categories = Array.isArray(row.categories)
    ? (row.categories as SplitCategory[])
    : DEFAULT_SETTINGS.categories;
  return {
    myName: row.my_name,
    partnerName: row.partner_name,
    currency: row.currency,
    locale: row.locale,
    categories,
    defaultCategoryId: row.default_category_id,
    lastExportAt: row.last_export_at ?? undefined,
  };
}
