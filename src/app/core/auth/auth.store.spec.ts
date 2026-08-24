import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppConfig } from '../config/app-config.model';
import { AuthStore } from './auth.store';

type AuthListener = (event: string, session: unknown) => void;

const CONFIG: AppConfig = { supabaseUrl: 'https://abc.supabase.co', supabaseAnonKey: 'a'.repeat(40) };

const { authState, listeners, mockClient } = vi.hoisted(() => {
  const listeners: AuthListener[] = [];
  const authState: { session: { user: { id: string; email: string } } | null } = { session: null };

  const mockClient = {
    auth: {
      onAuthStateChange: vi.fn((callback: AuthListener) => {
        listeners.push(callback);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      getSession: vi.fn(async () => ({ data: { session: authState.session } })),
      signInWithPassword: vi.fn(async ({ email, password }: { email: string; password: string }) => {
        if (password === 'wrong') {
          return { error: { message: 'Invalid login credentials' } };
        }
        authState.session = { user: { id: 'user-1', email } };
        for (const listener of listeners) {
          listener('SIGNED_IN', authState.session);
        }
        return { error: null };
      }),
      signOut: vi.fn(async () => {
        authState.session = null;
        for (const listener of listeners) {
          listener('SIGNED_OUT', null);
        }
        return { error: null };
      }),
    },
  };

  return { authState, listeners, mockClient };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockClient),
}));

describe('AuthStore', () => {
  beforeEach(() => {
    authState.session = null;
    listeners.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal('location', { ...window.location, reload: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is disabled in local mode, without touching Supabase at all', () => {
    const auth = new AuthStore();
    auth.disable();

    expect(auth.status()).toBe('disabled');
    expect(auth.readyToLoad()).toBe(true);
    expect(mockClient.auth.getSession).not.toHaveBeenCalled();
  });

  it('reports signed-out when there is no existing session', async () => {
    const auth = new AuthStore();
    await auth.init(CONFIG);

    expect(auth.status()).toBe('signed-out');
    expect(auth.readyToLoad()).toBe(false);
  });

  it('reports signed-in immediately when a session is already persisted', async () => {
    authState.session = { user: { id: 'user-1', email: 'me@example.com' } };
    const auth = new AuthStore();
    await auth.init(CONFIG);

    expect(auth.status()).toBe('signed-in');
    expect(auth.readyToLoad()).toBe(true);
    expect(auth.user()).toEqual({ id: 'user-1', email: 'me@example.com' });
  });

  it('signs in and flips the gate open', async () => {
    const auth = new AuthStore();
    await auth.init(CONFIG);

    await auth.signIn('me@example.com', 'correct-password');

    expect(auth.status()).toBe('signed-in');
    expect(auth.readyToLoad()).toBe(true);
    expect(auth.error()).toBeNull();
  });

  it('surfaces a failed sign-in without changing status', async () => {
    const auth = new AuthStore();
    await auth.init(CONFIG);

    await auth.signIn('me@example.com', 'wrong');

    expect(auth.status()).toBe('signed-out');
    expect(auth.error()).toBe('Invalid login credentials');
  });

  it('reloads the page on sign-out, once a session existed', async () => {
    const auth = new AuthStore();
    await auth.init(CONFIG);
    await auth.signIn('me@example.com', 'correct-password');

    await auth.signOut();

    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload for the very first (no-session) auth check', async () => {
    const auth = new AuthStore();
    await auth.init(CONFIG);

    expect(window.location.reload).not.toHaveBeenCalled();
  });
});
