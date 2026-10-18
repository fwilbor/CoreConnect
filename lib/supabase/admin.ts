import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./server";

// Secret-key client for Auth admin calls (inviting owners). Server code only.
export function createSupabaseAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createClient(supabaseUrl(), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
