import { Injectable, signal } from '@angular/core';
import { AppConfig, AppConfigParseError, parseAppConfig } from './app-config.model';

export type AppConfigStatus = 'loading' | 'local' | 'remote' | 'error';

/**
 * Loads `config.json` once at startup. No file (or a 404, which is the normal
 * case for anyone who hasn't set up Supabase) means "run local-only" — that is
 * not an error. A file that exists but fails to parse *is* surfaced, so a typo
 * in the config doesn't silently discard the user's intent to sync.
 */
@Injectable({ providedIn: 'root' })
export class AppConfigStore {
  private readonly statusSignal = signal<AppConfigStatus>('loading');
  private readonly configSignal = signal<AppConfig | null>(null);
  private readonly errorSignal = signal<string | null>(null);

  readonly status = this.statusSignal.asReadonly();
  readonly config = this.configSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();

  dismissError(): void {
    this.errorSignal.set(null);
  }

  async load(): Promise<void> {
    try {
      const response = await fetch('/config.json', { cache: 'no-store' });
      if (!response.ok) {
        this.statusSignal.set('local');
        return;
      }
      const config = parseAppConfig(await response.json());
      this.configSignal.set(config);
      this.statusSignal.set(config ? 'remote' : 'local');
    } catch (error) {
      // A malformed config.json is a mistake worth surfacing; a missing file
      // or a network hiccup just means "no config" and we go local silently.
      const isParseFailure = error instanceof SyntaxError || error instanceof AppConfigParseError;
      this.statusSignal.set(isParseFailure ? 'error' : 'local');
      if (isParseFailure) {
        this.errorSignal.set(error instanceof Error ? error.message : 'config.json is invalid.');
      }
    }
  }
}
