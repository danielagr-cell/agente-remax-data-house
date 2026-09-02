import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

if (!config.supabase.url || !config.supabase.serviceKey) {
  throw new Error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY (mirá .env.example).');
}

// Cliente con SERVICE ROLE: solo backend. Bypassa RLS.
export const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
