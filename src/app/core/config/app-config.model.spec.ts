import { describe, expect, it } from 'vitest';
import { AppConfigParseError, parseAppConfig } from './app-config.model';

const KEY = 'a'.repeat(40);

describe('parseAppConfig', () => {
  it('returns null when the file has neither Supabase key', () => {
    expect(parseAppConfig({})).toBeNull();
    expect(parseAppConfig({ someOtherSetting: true })).toBeNull();
  });

  it('parses a valid config', () => {
    expect(parseAppConfig({ supabaseUrl: 'https://abc.supabase.co', supabaseAnonKey: KEY })).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabaseAnonKey: KEY,
    });
  });

  it('rejects a non-https URL', () => {
    expect(() => parseAppConfig({ supabaseUrl: 'http://abc.supabase.co', supabaseAnonKey: KEY })).toThrow(
      AppConfigParseError,
    );
  });

  it('rejects a missing or empty anon key', () => {
    expect(() => parseAppConfig({ supabaseUrl: 'https://abc.supabase.co' })).toThrow(AppConfigParseError);
    expect(() => parseAppConfig({ supabaseUrl: 'https://abc.supabase.co', supabaseAnonKey: 'short' })).toThrow(
      AppConfigParseError,
    );
  });

  it('rejects a non-object payload', () => {
    expect(() => parseAppConfig(null)).toThrow(AppConfigParseError);
    expect(() => parseAppConfig([1, 2])).toThrow(AppConfigParseError);
    expect(() => parseAppConfig('nope')).toThrow(AppConfigParseError);
  });
});
