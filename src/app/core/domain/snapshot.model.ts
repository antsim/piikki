import { isValidIsoDate } from './dates';
import { DEFAULT_SETTINGS, LedgerSettings } from './settings.model';
import { SplitCategory } from './split-category.model';
import {
  normalisePersonalAmounts,
  Payer,
  PersonalAmounts,
  SplitKind,
  Transaction,
} from './transaction.model';

/**
 * Bumped to 2 when personal items arrived. A v1 file still restores here (it
 * simply has nothing personal in it), but an older build refuses a v2 file
 * outright rather than importing it with the personal amounts silently
 * dropped — which would quietly change the balance.
 */
export const SNAPSHOT_VERSION = 2;
const SNAPSHOT_APP = 'piikki';

/** The shape of the JSON backup file. */
export interface LedgerSnapshot {
  readonly app: typeof SNAPSHOT_APP;
  readonly version: number;
  readonly exportedAt: string;
  readonly settings: LedgerSettings;
  readonly transactions: readonly Transaction[];
}

export class SnapshotParseError extends Error {}

export function createSnapshot(
  transactions: readonly Transaction[],
  settings: LedgerSettings,
): LedgerSnapshot {
  return {
    app: SNAPSHOT_APP,
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    transactions,
  };
}

/**
 * Backup files are user-supplied input, so everything is validated before it is
 * allowed anywhere near the store.
 */
export function parseSnapshot(raw: unknown): LedgerSnapshot {
  const root = asRecord(raw, 'The file is not a piikki backup.');

  if (root['app'] !== SNAPSHOT_APP) {
    throw new SnapshotParseError('The file is not a piikki backup.');
  }
  if (typeof root['version'] !== 'number' || root['version'] > SNAPSHOT_VERSION) {
    throw new SnapshotParseError(
      `Backup version ${String(root['version'])} is newer than this app understands.`,
    );
  }
  if (!Array.isArray(root['transactions'])) {
    throw new SnapshotParseError('The backup has no transactions array.');
  }

  const settings = parseSettings(root['settings']);
  const transactions = root['transactions'].map((item, index) => parseTransaction(item, index));

  return {
    app: SNAPSHOT_APP,
    version: SNAPSHOT_VERSION,
    exportedAt: typeof root['exportedAt'] === 'string' ? root['exportedAt'] : new Date().toISOString(),
    settings,
    transactions,
  };
}

function parseTransaction(raw: unknown, index: number): Transaction {
  const where = `Transaction #${index + 1}`;
  const item = asRecord(raw, `${where} is not an object.`);

  const date = item['date'];
  if (typeof date !== 'string' || !isValidIsoDate(date)) {
    throw new SnapshotParseError(`${where} has an invalid date.`);
  }
  const amountCents = item['amountCents'];
  if (typeof amountCents !== 'number' || !Number.isFinite(amountCents)) {
    throw new SnapshotParseError(`${where} has an invalid amount.`);
  }
  const payer = item['payer'];
  if (payer !== 'me' && payer !== 'partner') {
    throw new SnapshotParseError(`${where} has an invalid payer.`);
  }

  const now = new Date().toISOString();
  const rounded = Math.round(Math.abs(amountCents));
  return {
    id: typeof item['id'] === 'string' && item['id'] ? item['id'] : crypto.randomUUID(),
    date,
    description: typeof item['description'] === 'string' ? item['description'] : '',
    amountCents: rounded,
    payer: payer as Payer,
    categoryId: typeof item['categoryId'] === 'string' ? item['categoryId'] : 'household',
    split: parseSplit(item['split'], where),
    personal: parsePersonal(item['personal'], rounded),
    note: typeof item['note'] === 'string' ? item['note'] : undefined,
    createdAt: typeof item['createdAt'] === 'string' ? item['createdAt'] : now,
    updatedAt: typeof item['updatedAt'] === 'string' ? item['updatedAt'] : now,
  };
}

/**
 * Personal items are optional and were not in v1 backups, so anything that
 * isn't a usable pair of numbers just means "nothing personal" — no reason to
 * fail a whole restore over it. `normalisePersonalAmounts` does the clamping.
 */
function parsePersonal(raw: unknown, amountCents: number): PersonalAmounts | undefined {
  if (raw === null || typeof raw !== 'object') {
    return undefined;
  }
  const item = raw as Record<string, unknown>;
  return normalisePersonalAmounts(
    {
      mineCents: typeof item['mineCents'] === 'number' ? item['mineCents'] : 0,
      partnerCents: typeof item['partnerCents'] === 'number' ? item['partnerCents'] : 0,
    },
    amountCents,
  );
}

function parseSplit(raw: unknown, where: string): { kind: SplitKind; myShare: number } {
  const split = asRecord(raw, `${where} has no split terms.`);
  const kind = split['kind'];
  if (kind !== 'expense' && kind !== 'settlement') {
    throw new SnapshotParseError(`${where} has an invalid split kind.`);
  }
  const myShare = split['myShare'];
  if (typeof myShare !== 'number' || myShare < 0 || myShare > 1) {
    throw new SnapshotParseError(`${where} has an invalid split share.`);
  }
  return { kind, myShare };
}

function parseSettings(raw: unknown): LedgerSettings {
  if (raw === null || typeof raw !== 'object') {
    return DEFAULT_SETTINGS;
  }
  const item = raw as Record<string, unknown>;
  const categories = Array.isArray(item['categories'])
    ? item['categories'].flatMap((entry) => parseCategory(entry) ?? [])
    : [];

  return {
    myName: stringOr(item['myName'], DEFAULT_SETTINGS.myName),
    partnerName: stringOr(item['partnerName'], DEFAULT_SETTINGS.partnerName),
    currency: stringOr(item['currency'], DEFAULT_SETTINGS.currency),
    locale: stringOr(item['locale'], DEFAULT_SETTINGS.locale),
    categories: categories.length ? categories : DEFAULT_SETTINGS.categories,
    defaultCategoryId: stringOr(item['defaultCategoryId'], DEFAULT_SETTINGS.defaultCategoryId),
    lastExportAt: typeof item['lastExportAt'] === 'string' ? item['lastExportAt'] : undefined,
  };
}

function parseCategory(raw: unknown): SplitCategory | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const item = raw as Record<string, unknown>;
  const kind = item['kind'];
  if (typeof item['id'] !== 'string' || (kind !== 'expense' && kind !== 'settlement')) {
    return null;
  }
  const myShare = typeof item['myShare'] === 'number' ? clamp(item['myShare'], 0, 1) : 0.5;
  return {
    id: item['id'],
    label: stringOr(item['label'], item['id']),
    kind,
    myShare,
    archived: item['archived'] === true,
  };
}

function asRecord(raw: unknown, message: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SnapshotParseError(message);
  }
  return raw as Record<string, unknown>;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
