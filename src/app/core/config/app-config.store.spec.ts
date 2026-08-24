import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppConfigStore } from './app-config.store';

const KEY = 'a'.repeat(40);

describe('AppConfigStore', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('goes local when config.json is missing (404)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as typeof fetch;

    const store = new AppConfigStore();
    await store.load();

    expect(store.status()).toBe('local');
    expect(store.config()).toBeNull();
    expect(store.error()).toBeNull();
  });

  it('goes local when fetch itself fails (offline, no dev server route)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const store = new AppConfigStore();
    await store.load();

    expect(store.status()).toBe('local');
  });

  it('goes remote with a valid config', async () => {
    const body = JSON.stringify({ supabaseUrl: 'https://abc.supabase.co', supabaseAnonKey: KEY });
    globalThis.fetch = vi.fn(async () => new Response(body, { status: 200 })) as typeof fetch;

    const store = new AppConfigStore();
    await store.load();

    expect(store.status()).toBe('remote');
    expect(store.config()).toEqual({ supabaseUrl: 'https://abc.supabase.co', supabaseAnonKey: KEY });
  });

  it('surfaces an error for a malformed config.json instead of silently going local', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{ not json', { status: 200 })) as typeof fetch;

    const store = new AppConfigStore();
    await store.load();

    expect(store.status()).toBe('error');
    expect(store.error()).not.toBeNull();
  });

  it('surfaces an error for a config.json with an invalid Supabase URL', async () => {
    const body = JSON.stringify({ supabaseUrl: 'not-a-url', supabaseAnonKey: KEY });
    globalThis.fetch = vi.fn(async () => new Response(body, { status: 200 })) as typeof fetch;

    const store = new AppConfigStore();
    await store.load();

    expect(store.status()).toBe('error');
  });
});
