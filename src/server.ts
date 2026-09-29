import "./lib/error-capture";

import handler from "@tanstack/react-start/server-entry";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type RateLimitBinding = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
};

type Env = {
  HTTP_RATE_LIMITER?: RateLimitBinding;
  // Segredo SOMENTE de runtime do Worker. Nunca usar prefixo VITE_ porque isso o exporia no frontend.
  VAULT_RECOVERY_SECRET?: string;
};

type ServerHandler = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

const serverHandler = handler as unknown as ServerHandler;

const SUPABASE_URL = String(import.meta.env["VITE_SUPABASE_URL"] ?? "").trim();
const SUPABASE_PUBLISHABLE_KEY = String(
  import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]
  ?? import.meta.env["VITE_SUPABASE_ANON_KEY"]
  ?? "",
).trim();
const encoder = new TextEncoder();

type VerifiedUser = { id: string; email?: string };

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function readJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function verifyAal2User(request: Request): Promise<{ user: VerifiedUser; token: string } | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  const user = await response.json() as VerifiedUser;
  if (!user?.id) return null;

  // O JWT só é lido DEPOIS de o endpoint Auth do Supabase validar a assinatura/sessão.
  const payload = readJwtPayload(token);
  if (payload?.["aal"] !== "aal2") return null;
  return { user, token };
}

async function vaultRecoveryAesKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`tages-anna:vault-email-recovery:v1:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function handleVaultRecoveryApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/vault-email-recovery/")) return null;

  if (request.method !== "POST") {
    return new Response("Método não permitido", { status: 405, headers: { allow: "POST" } });
  }
  if (!env.VAULT_RECOVERY_SECRET || env.VAULT_RECOVERY_SECRET.length < 32) {
    return Response.json({ error: "Recuperação por e-mail ainda não foi configurada no servidor." }, { status: 503 });
  }

  const verified = await verifyAal2User(request);
  if (!verified) return Response.json({ error: "Sessão AAL2 obrigatória." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const aesKey = await vaultRecoveryAesKey(env.VAULT_RECOVERY_SECRET);
  const aad = encoder.encode(`tages-anna:vault-email-recovery:v1:user:${verified.user.id}`);

  if (url.pathname.endsWith("/provision")) {
    const rawKey = typeof body["rawKey"] === "string" ? body["rawKey"] : "";
    let rawBytes: Uint8Array;
    try { rawBytes = base64ToBytes(rawKey); } catch { return Response.json({ error: "Chave clínica inválida." }, { status: 400 }); }
    if (rawBytes.byteLength !== 32) return Response.json({ error: "Chave clínica inválida." }, { status: 400 });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, aesKey, rawBytes);
    return Response.json({
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
      iv: bytesToBase64(iv),
      version: 1,
    }, { headers: { "cache-control": "no-store" } });
  }

  if (url.pathname.endsWith("/recover")) {
    const ciphertext = typeof body["ciphertext"] === "string" ? body["ciphertext"] : "";
    const ivValue = typeof body["iv"] === "string" ? body["iv"] : "";
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(ivValue), additionalData: aad },
        aesKey,
        base64ToBytes(ciphertext),
      );
      const rawBytes = new Uint8Array(decrypted);
      if (rawBytes.byteLength !== 32) throw new Error("invalid key length");
      return Response.json({ rawKey: bytesToBase64(rawBytes) }, { headers: { "cache-control": "no-store" } });
    } catch {
      return Response.json({ error: "Não foi possível recuperar a chave clínica com esta configuração." }, { status: 400 });
    }
  }

  return new Response("Não encontrado", { status: 404 });
}

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://challenges.cloudflare.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function isDocumentRequest(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return true;
  const destination = request.headers.get("sec-fetch-dest");
  if (destination === "document") return true;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

async function enforceRateLimit(request: Request, env: Env) {
  if (!env.HTTP_RATE_LIMITER || !isDocumentRequest(request)) return true;
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const result = await env.HTTP_RATE_LIMITER.limit({ key: ip });
  return result.success;
}

function secureResponse(response: Response, request: Request) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);

  const contentType = secured.headers.get("content-type") ?? "";
  if (contentType.includes("text/html") || isDocumentRequest(request)) {
    secured.headers.set("Cache-Control", "no-store, max-age=0");
    secured.headers.set("Pragma", "no-cache");
  }
  return secured;
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error("SSR interno não tratado"));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: unknown) {
    try {
      if (!(await enforceRateLimit(request, env))) {
        return secureResponse(new Response("Muitas requisições. Tente novamente em instantes.", {
          status: 429,
          headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "60" },
        }), request);
      }

      const vaultRecoveryResponse = await handleVaultRecoveryApi(request, env);
      if (vaultRecoveryResponse) return secureResponse(vaultRecoveryResponse, request);

      const response = await serverHandler.fetch(request, env, ctx);
      return secureResponse(await normalizeCatastrophicSsrResponse(response), request);
    } catch (error) {
      console.error(error);
      return secureResponse(new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }), request);
    }
  },
};
