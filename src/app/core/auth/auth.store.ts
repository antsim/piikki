import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { computed, Injectable, signal } from '@angular/core';
import { AppConfig } from '../config/app-config.model';
import { AuthStatus, AuthUser } from './auth.model';
import { getSupabaseClient } from './supabase-client';

/**
 * Cloud mode only: two known people sign in with an email and password
 * created ahead of time in the Supabase dashboard (see README) — there is no
 * self-signup form, deliberately, since the whole point is exactly two
 * accounts. Local mode never touches this; `disable()` marks it inert.
 *
 * A signed-in session persists in the browser (Supabase's default) and
 * refreshes itself, so signing in is a once-per-device action, not a
 * once-per-visit one.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly statusSignal = signal<AuthStatus>('checking');
  private readonly userSignal = signal<AuthUser | null>(null);
  private readonly errorSignal = signal<string | null>(null);
  private client: SupabaseClient | null = null;

  readonly status = this.statusSignal.asReadonly();
  readonly user = this.userSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();

  /** True once it's safe for LedgerStore to load: nothing to log into, or already signed in. */
  readonly readyToLoad = computed(() => {
    const status = this.statusSignal();
    return status === 'disabled' || status === 'signed-in';
  });

  /** Local mode: there is no Supabase project, so there is nothing to authenticate. */
  disable(): void {
    this.statusSignal.set('disabled');
  }

  /**
   * Cloud mode: connect to Supabase Auth and start tracking the session.
   * Never throws — a failure here (e.g. the Supabase SDK chunk failing to
   * load) surfaces as an 'error' status with a message the login screen can
   * show, rather than taking down app bootstrap.
   */
  async init(config: AppConfig): Promise<void> {
    try {
      this.client = await getSupabaseClient(config);

      this.client.auth.onAuthStateChange((_event, session) => {
        const wasSignedIn = this.statusSignal() === 'signed-in';
        this.applySession(session);
        // A session that was there and now isn't — explicit sign-out, a
        // revoked/expired refresh token, the user signed out in another tab —
        // is simplest to handle with a hard reload: it resets every
        // in-memory signal at once instead of hand-writing teardown for each.
        if (wasSignedIn && !session) {
          window.location.reload();
        }
      });

      const { data } = await this.client.auth.getSession();
      this.applySession(data.session);
    } catch (error) {
      this.statusSignal.set('error');
      this.errorSignal.set(
        error instanceof Error ? error.message : 'Could not connect to Supabase Auth.',
      );
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    if (!this.client) {
      return;
    }
    this.errorSignal.set(null);
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) {
      this.errorSignal.set(error.message);
    }
    // On success, onAuthStateChange fires and moves status to 'signed-in'.
  }

  async signOut(): Promise<void> {
    await this.client?.auth.signOut();
    // onAuthStateChange reloads the page — see init().
  }

  dismissError(): void {
    this.errorSignal.set(null);
  }

  private applySession(session: Session | null): void {
    this.userSignal.set(session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null);
    this.statusSignal.set(session ? 'signed-in' : 'signed-out');
  }
}
