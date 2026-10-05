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
  // Perfil de homologação: autenticação própria do Worker. Não usa Supabase Auth nem grava dados no Supabase.
  TEST_LOGIN_EMAIL?: string;
  TEST_LOGIN_PASSWORD?: string;
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


const TEST_SESSION_COOKIE = "tages_test_session";
const TEST_SESSION_SECONDS = 8 * 60 * 60;

function base64UrlEncode(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function testSessionKey(env: Env) {
  const password = String(env.TEST_LOGIN_PASSWORD ?? "");
  const email = String(env.TEST_LOGIN_EMAIL ?? "").trim().toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`tages:test-session:v1:${email}:${password}`));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function safeEqual(left: string, right: string) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  if (av.length !== bv.length) return false;
  let diff = 0;
  for (let i = 0; i < av.length; i += 1) diff |= av[i]! ^ bv[i]!;
  return diff === 0;
}

function readCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") ?? "";
  for (const piece of raw.split(";")) {
    const [key, ...rest] = piece.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

async function createTestSession(env: Env, email: string) {
  const payload = JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + TEST_SESSION_SECONDS });
  const encoded = base64UrlEncode(payload);
  const key = await testSessionKey(env);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(encoded)));
  return `${encoded}.${base64UrlEncode(signature)}`;
}

async function verifyTestSession(request: Request, env: Env) {
  const configuredEmail = String(env.TEST_LOGIN_EMAIL ?? "").trim().toLowerCase();
  if (!configuredEmail || !env.TEST_LOGIN_PASSWORD) return null;
  const token = readCookie(request, TEST_SESSION_COOKIE);
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) return null;
  try {
    const key = await testSessionKey(env);
    const valid = await crypto.subtle.verify("HMAC", key, base64UrlDecode(signaturePart), encoder.encode(payloadPart));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart))) as { email?: string; exp?: number };
    if (payload.email?.toLowerCase() !== configuredEmail || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { email: configuredEmail };
  } catch {
    return null;
  }
}

async function handleTestAuthApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/test-auth/")) return null;

  const email = String(env.TEST_LOGIN_EMAIL ?? "").trim().toLowerCase();
  const password = String(env.TEST_LOGIN_PASSWORD ?? "");
  const enabled = Boolean(email && password.length >= 8);

  if (url.pathname.endsWith("/info") && request.method === "GET") {
    return Response.json({ enabled }, { headers: { "cache-control": "no-store" } });
  }

  if (url.pathname.endsWith("/match") && request.method === "POST") {
    if (!enabled) return Response.json({ matched: false }, { headers: { "cache-control": "no-store" } });
    let body: { email?: string };
    try { body = await request.json() as { email?: string }; } catch { return Response.json({ matched: false }, { status: 400 }); }
    const matched = await safeEqual(String(body.email ?? "").trim().toLowerCase(), email);
    return Response.json({ matched }, { headers: { "cache-control": "no-store" } });
  }

  if (url.pathname.endsWith("/session") && request.method === "GET") {
    const session = await verifyTestSession(request, env);
    return Response.json({ authenticated: Boolean(session), email: session?.email ?? null }, { headers: { "cache-control": "no-store" } });
  }

  if (url.pathname.endsWith("/login") && request.method === "POST") {
    if (!enabled) return Response.json({ error: "Perfil de teste ainda não foi configurado no servidor." }, { status: 503 });
    let body: { email?: string; password?: string };
    try { body = await request.json() as { email?: string; password?: string }; } catch { return Response.json({ error: "Requisição inválida." }, { status: 400 }); }
    const emailOk = await safeEqual(String(body.email ?? "").trim().toLowerCase(), email);
    const passwordOk = await safeEqual(String(body.password ?? ""), password);
    if (!emailOk) return Response.json({ matched: false }, { status: 404 });
    if (!passwordOk) return Response.json({ matched: true, error: "Credenciais inválidas." }, { status: 401 });
    const token = await createTestSession(env, email);
    return Response.json({ ok: true, email }, {
      headers: {
        "cache-control": "no-store",
        "set-cookie": `${TEST_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TEST_SESSION_SECONDS}`,
      },
    });
  }

  if (url.pathname.endsWith("/logout") && request.method === "POST") {
    return Response.json({ ok: true }, { headers: { "set-cookie": `${TEST_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`, "cache-control": "no-store" } });
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

      const testAuthResponse = await handleTestAuthApi(request, env);
      if (testAuthResponse) return secureResponse(testAuthResponse, request);

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
