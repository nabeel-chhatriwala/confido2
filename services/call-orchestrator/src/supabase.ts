import { createServiceClient } from '@confido/shared';
import { config } from './config.js';

export const supabase = createServiceClient({
  supabaseUrl: config.supabaseUrl,
  serviceRoleKey: config.supabaseServiceRoleKey,
});
