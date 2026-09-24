import "./lib/error-capture";

import handler from "@tanstack/react-start/server-entry";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type RateLimitBinding = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
};

type Env = {
  HTTP_RATE_LIMITER?: RateLimitBinding;
};

type ServerHandler = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

const serverHandler = handler as unknown as ServerHandler;

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
