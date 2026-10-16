import { NextResponse, type NextRequest } from "next/server";
import { generateCspNonce } from "./lib/cspPolicy";

/**
 * Attaches a per-request CSP nonce (issue #1039).
 *
 * Next.js reads the nonce from the `Content-Security-Policy` *request* header
 * and copies it onto the inline bootstrap/RSC scripts it emits, which is the
 * documented mechanism for a strict `script-src` with no `'unsafe-inline'`.
 * The nonce is also forwarded to the response header so the browser sees the
 * same value.
 *
 * The nonce is generated per request and is never reused, so it cannot be
 * predicted by an injected script the way a build-time constant could.
 *
 * Note: `next.config.ts` still sets a nonce-free baseline policy for requests
 * that do not pass through middleware (and as a defence in depth). This
 * middleware's response header takes precedence for requests it handles.
 */
export function middleware(request: NextRequest) {
  const nonce = generateCspNonce();

  // Forward on the request so Next.js can stamp it onto inline scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-csp-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", buildRequestPolicy(nonce));

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", buildRequestPolicy(nonce));
  return response;
}

/**
 * The per-request policy. Only the directives that must carry the nonce are
 * rebuilt here; `next.config.ts` owns the full static policy (images, connect
 * sources), and duplicating that list in two places is how they drift.
 */
function buildRequestPolicy(nonce: string): string {
  return [
    `script-src 'self' 'wasm-unsafe-eval' 'nonce-${nonce}'`,
    // Next.js emits a nonce-bearing style tag for critical CSS.
    `style-src 'self' 'unsafe-inline' 'nonce-${nonce}'`,
  ].join("; ");
}

export const config = {
  // Skip static assets and API routes: they are not documents, so they do not
  // need a nonce, and running middleware for them would only add latency.
  matcher: [
    /*
     * Match all paths except:
     *   - /_next/static, /_next/image  (build output)
     *   - favicon, robots, sitemap     (crawler files)
     *   - files with an extension      (public assets)
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.[\\w]+$).*)",
    /*
     * Include all API routes so a JSON response also carries a nonce-bearing
     * policy; harmless, and avoids a second matcher for a future API surface.
     */
    "/api/:path*",
  ],
};
