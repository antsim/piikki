import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { AppConfig } from '../config/app-config.model';
import { LedgerSettings } from '../domain/settings.model';
import { Transaction } from '../domain/transaction.model';
import { LedgerStorage, PersistedLedger } from './ledger-storage';
import {
  rowToSettings,
  rowToTransaction,
  SETTINGS_ROW_ID,
  settingsToRow,
  SettingsRow,
  transactionToRow,
  TransactionRow,
} from './supabase-mapping';

const TRANSACTIONS_TABLE = 'transactions';
const SETTINGS_TABLE = 'settings';
/** Never a real id — used to build an unfiltered-looking delete Supabase will still accept. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Shared, always-on storage: every write lands in Postgres immediately, and a
 * Realtime subscription notifies the store when the *other* device changes
 * something, so both devices converge without either one polling.
 *
 * There is no login yet, so this relies on the anon key plus permissive Row
 * Level Security policies (see supabase/schema.sql) — the page itself, behind
 * the hosting provider's password, is the access boundary. See the schema
 * file for how to tighten this once real auth is added.
 */
export class SupabaseLedgerStorage extends LedgerStorage {
  override readonly durable = true;
  override readonly backend = 'cloud' as const;

  private readonly client: SupabaseClient;

  constructor(config: AppConfig) {
    super();
    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
  }

  async load(): Promise<PersistedLedger> {
    const [transactionsResult, settingsResult] = await Promise.all([
      this.client.from(TRANSACTIONS_TABLE).select('*').order('date', { ascending: true }),
      this.client.from(SETTINGS_TABLE).select('*').eq('id', SETTINGS_ROW_ID).maybeSingle(),
    ]);

    if (transactionsResult.error) {
      throw new Error(`Could not load transactions: ${transactionsResult.error.message}`);
    }
    if (settingsResult.error) {
      throw new Error(`Could not load settings: ${settingsResult.error.message}`);
    }

    return {
      transactions: (transactionsResult.data as TransactionRow[]).map(rowToTransaction),
      settings: settingsResult.data ? rowToSettings(settingsResult.data as SettingsRow) : null,
    };
  }

  async putTransaction(transaction: Transaction): Promise<void> {
    const { error } = await this.client.from(TRANSACTIONS_TABLE).upsert(transactionToRow(transaction));
    if (error) {
      throw new Error(`Could not save the transaction: ${error.message}`);
    }
  }

  async deleteTransaction(id: string): Promise<void> {
    const { error } = await this.client.from(TRANSACTIONS_TABLE).delete().eq('id', id);
    if (error) {
      throw new Error(`Could not delete the transaction: ${error.message}`);
    }
  }

  async putSettings(settings: LedgerSettings): Promise<void> {
    const { error } = await this.client.from(SETTINGS_TABLE).upsert(settingsToRow(settings));
    if (error) {
      throw new Error(`Could not save settings: ${error.message}`);
    }
  }

  /**
   * Used by backup import and "start over". Supabase has no client-side
   * multi-statement transaction, so this is delete-then-insert rather than
   * one atomic swap — acceptable for a rare, explicit bulk action on a
   * two-person ledger, but a concurrent write from the other device during
   * the gap between the two calls could be lost.
   */
  async replaceAll(transactions: readonly Transaction[], settings: LedgerSettings): Promise<void> {
    const { error: deleteError } = await this.client.from(TRANSACTIONS_TABLE).delete().neq('id', NIL_UUID);
    if (deleteError) {
      throw new Error(`Could not clear existing transactions: ${deleteError.message}`);
    }
    if (transactions.length) {
      const { error: insertError } = await this.client
        .from(TRANSACTIONS_TABLE)
        .insert(transactions.map(transactionToRow));
      if (insertError) {
        throw new Error(`Could not write the imported transactions: ${insertError.message}`);
      }
    }
    await this.putSettings(settings);
  }

  override onRemoteChange(listener: () => void): () => void {
    const channel: RealtimeChannel = this.client
      .channel('piikki-ledger-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: TRANSACTIONS_TABLE }, () => listener())
      .on('postgres_changes', { event: '*', schema: 'public', table: SETTINGS_TABLE }, () => listener())
      .subscribe();

    return () => void this.client.removeChannel(channel);
  }
}
