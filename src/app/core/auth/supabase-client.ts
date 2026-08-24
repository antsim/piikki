import type { SupabaseClient } from '@supabase/supabase-js';
import { AppConfig } from '../config/app-config.model';

/**
 * The Supabase SDK warns (and can misbehave with duplicate auth listeners) if
 * more than one client is created for the same project in a page, so the
 * storage adapter and the auth store share this single lazily-created
 * instance rather than each importing `@supabase/supabase-js` on their own.
 * The dynamic `import()` is what keeps the SDK out of the bundle for anyone
 * who never configures cloud mode.
 */
let clientPromise: Promise<SupabaseClient> | null = null;

export function getSupabaseClient(config: AppConfig): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(config.supabaseUrl, config.supabaseAnonKey),
  );
  return clientPromise;
}
