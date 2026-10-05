import { supabase } from "../../lib/supabase";
import { isTestMode } from "../../lib/test-mode";
import type { SupabaseUsageSnapshot } from "./types";

export async function getSupabaseUsageSnapshot() {
  if (isTestMode()) {
    const response = await fetch("/api/test-supabase-usage", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    let payload: (Partial<SupabaseUsageSnapshot> & { error?: string }) | null = null;
    try {
      payload = await response.json() as Partial<SupabaseUsageSnapshot> & { error?: string };
    } catch {
      payload = null;
    }
    if (!response.ok || !payload) {
      throw new Error(payload?.error || "Não foi possível consultar o uso do Supabase.");
    }
    if (typeof payload.generated_at !== "string") throw new Error("Resposta de uso do Supabase inválida.");
    return payload as SupabaseUsageSnapshot;
  }

  if (!supabase) throw new Error("Supabase não configurado.");
  const { data, error } = await supabase.rpc("get_supabase_usage_snapshot");
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("Não foi possível ler o uso do Supabase.");
  return {
    ...(data as SupabaseUsageSnapshot),
    api_requests: 0,
    auth_requests: 0,
    realtime_requests: 0,
    rest_requests: 0,
    storage_requests: 0,
    disk_size_gb: null,
    disk_used_bytes: 0,
    disk_total_bytes: 0,
    disk_usage_percent: null,
  } as SupabaseUsageSnapshot;
}
