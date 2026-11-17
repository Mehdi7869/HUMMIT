import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
let supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

export let isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('http') &&
    !supabaseUrl.includes('YOUR_SUPABASE')
);

let clientInstance: SupabaseClient | null = null;

function createInstance(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

if (isSupabaseConfigured) {
  clientInstance = createInstance(supabaseUrl, supabaseAnonKey);
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!clientInstance && isSupabaseConfigured) {
    clientInstance = createInstance(supabaseUrl, supabaseAnonKey);
  }
  return clientInstance;
}

let configPromise: Promise<boolean> | null = null;

/**
 * Ensures Supabase client is initialized.
 * If Vite build-time environment variables were missing,
 * fetches runtime configuration from /api/config.
 */
export async function ensureSupabaseConfig(): Promise<boolean> {
  if (isSupabaseConfigured && clientInstance) return true;
  if (configPromise) return configPromise;

  configPromise = (async () => {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) return false;
      const data = await res.json();
      if (
        data.supabaseUrl &&
        data.supabaseAnonKey &&
        typeof data.supabaseUrl === 'string' &&
        data.supabaseUrl.startsWith('http') &&
        !data.supabaseUrl.includes('YOUR_SUPABASE')
      ) {
        supabaseUrl = data.supabaseUrl.trim();
        supabaseAnonKey = data.supabaseAnonKey.trim();
        isSupabaseConfigured = true;
        clientInstance = createInstance(supabaseUrl, supabaseAnonKey);
        return true;
      }
    } catch (err) {
      console.warn('Supabase dynamic runtime config skipped:', err);
    }
    return false;
  })();

  return configPromise;
}
