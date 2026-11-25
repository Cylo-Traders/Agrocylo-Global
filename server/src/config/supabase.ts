import { createClient } from '@supabase/supabase-js';
import { config } from './index.js';

let cachedClient: ReturnType<typeof createClient> | null = null;

export function isSupabaseConfigured(
  supabaseUrl: string = config.supabaseUrl,
  supabaseServiceRoleKey: string = config.supabaseServiceRoleKey,
): boolean {
  const url = (supabaseUrl ?? '').trim();
  const key = (supabaseServiceRoleKey ?? '').trim();
  if (!url || !key) return false;
  if (
    url.includes('placeholder.supabase.co') ||
    url.includes('YOUR_PROJECT_REF.supabase.co') ||
    url.includes('your-project.supabase.co')
  ) {
    return false;
  }
  if (
    key.startsWith('placeholder-') ||
    key.startsWith('YOUR_SUPABASE_') ||
    key === 'your-service-role-key'
  ) {
    return false;
  }
  return true;
}

export function getSupabaseAdmin() {
  if (cachedClient) return cachedClient;
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error(
      'Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  cachedClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}
