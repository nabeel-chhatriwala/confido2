import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function assertPoolerUrl(dbUrl: string): void {
  try {
    const host = new URL(dbUrl).host;
    if (!host.includes('.pooler.supabase.com')) {
      throw new Error(
        `Refusing to use non-pooler Supabase URL (host=${host}). Cloud Run requires the IPv4 pooler.`,
      );
    }
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(`Invalid database URL: ${dbUrl}`);
    }
    throw err;
  }
}

export interface ServiceClientConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  dbPoolerUrl?: string;
}

export function createServiceClient(cfg: ServiceClientConfig): SupabaseClient {
  if (cfg.dbPoolerUrl) {
    assertPoolerUrl(cfg.dbPoolerUrl);
  }
  return createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
