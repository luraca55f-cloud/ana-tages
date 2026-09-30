import { supabase } from "../../lib/supabase";
import type { SupabaseUsageSnapshot } from "./types";

export async function getSupabaseUsageSnapshot() {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data, error } = await supabase.rpc("get_supabase_usage_snapshot");
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("Não foi possível ler o uso do Supabase.");
  return data as SupabaseUsageSnapshot;
}
