import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rawUrl = import.meta.env["VITE_SUPABASE_URL"]?.trim();
const rawPublishableKey = (
  import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  import.meta.env["VITE_SUPABASE_ANON_KEY"]
)?.trim();

const looksConfigured = (value: string | undefined) => Boolean(value && !value.includes("SEU-PROJETO") && !value.includes("SUA_CHAVE"));

export const isSupabaseConfigured = looksConfigured(rawUrl) && looksConfigured(rawPublishableKey);
export const turnstileSiteKey = import.meta.env["VITE_TURNSTILE_SITE_KEY"]?.trim() || "";
export const idleTimeoutMinutes = Math.max(5, Math.min(120, Number(import.meta.env["VITE_IDLE_TIMEOUT_MINUTES"] || 30)));

const auth = typeof window !== "undefined"
  ? {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.sessionStorage,
      flowType: "pkce" as const,
    }
  : {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce" as const,
    };

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(rawUrl!, rawPublishableKey!, { auth })
  : null;
