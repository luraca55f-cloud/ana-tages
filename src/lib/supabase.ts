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

// A sessão normal continua restrita ao sessionStorage. O único dado que precisa atravessar
// a abertura do link enviado por e-mail é o PKCE code verifier; por isso ele é guardado
// temporariamente no localStorage. Sem isso, um link de recuperação aberto em outra aba
// pode chegar com `code`, mas o Supabase não consegue concluir exchangeCodeForSession().
const browserAuthStorage = typeof window !== "undefined"
  ? {
      getItem(key: string) {
        if (key.includes("code-verifier")) {
          return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
        }
        return window.sessionStorage.getItem(key);
      },
      setItem(key: string, value: string) {
        if (key.includes("code-verifier")) {
          window.localStorage.setItem(key, value);
          return;
        }
        window.sessionStorage.setItem(key, value);
      },
      removeItem(key: string) {
        if (key.includes("code-verifier")) {
          window.localStorage.removeItem(key);
          window.sessionStorage.removeItem(key);
          return;
        }
        window.sessionStorage.removeItem(key);
      },
    }
  : undefined;

const auth = typeof window !== "undefined"
  ? {
      persistSession: true,
      autoRefreshToken: true,
      // O callback de recuperação é processado explicitamente no AuthGate.
      // Não habilitar detecção automática sem revisar o fluxo PKCE + MFA.
      detectSessionInUrl: false,
      storage: browserAuthStorage,
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
