import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client — lazy initialized.
 *
 * The server boots normally without SUPABASE_URL / SUPABASE_KEY.
 * Media-related services call getSupabase() at runtime and get a clear
 * error if the env vars are missing, without blocking non-media routes.
 */
let _client: SupabaseClient | null = null;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;

if (url && key) {
  _client = createClient(url, key);
} else {
  console.warn(
    "[supabase] SUPABASE_URL or SUPABASE_KEY not set — media services will be unavailable"
  );
}

export function getSupabase(): SupabaseClient {
  if (!_client) {
    throw new Error(
      "[supabase] Client not initialized — set SUPABASE_URL and SUPABASE_KEY env vars"
    );
  }
  return _client;
}
