/**
 * Everything the app needs to talk to a Supabase project. This is fetched at
 * runtime from `config.json` rather than baked into the build, so the same
 * static build can be deployed anywhere and pointed at a project just by
 * editing a file on the host — no rebuild.
 *
 * Note: the Supabase URL and anon key are not secrets by Supabase's design —
 * they are meant to ship in client bundles and are protected by Row Level
 * Security, not by hiding them. Keeping them out of `config.json` from git is
 * about not committing a personal project identifier, not about leaking a
 * credential.
 */
export interface AppConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
}

export class AppConfigParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppConfigParseError';
  }
}

/**
 * Validates a fetched `config.json`. Returns null for "the file doesn't ask
 * for Supabase" (missing keys) so the app can fall back to local storage;
 * throws only when the file exists but is malformed, so a broken config
 * fails loudly instead of silently going local.
 */
export function parseAppConfig(raw: unknown): AppConfig | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppConfigParseError('config.json must be a JSON object.');
  }
  const item = raw as Record<string, unknown>;
  const hasAny = 'supabaseUrl' in item || 'supabaseAnonKey' in item;
  if (!hasAny) {
    return null;
  }

  const supabaseUrl = item['supabaseUrl'];
  if (typeof supabaseUrl !== 'string' || !/^https:\/\/.+/.test(supabaseUrl)) {
    throw new AppConfigParseError('config.json.supabaseUrl must be an https:// URL.');
  }
  const supabaseAnonKey = item['supabaseAnonKey'];
  if (typeof supabaseAnonKey !== 'string' || supabaseAnonKey.trim().length < 20) {
    throw new AppConfigParseError('config.json.supabaseAnonKey looks too short to be valid.');
  }

  return { supabaseUrl, supabaseAnonKey };
}
