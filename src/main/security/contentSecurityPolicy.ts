/**
 * Content-Security-Policy builders for LedgerPage.
 *
 * Deliberately two separate, explicit functions rather than one function
 * branching internally on an optional parameter — production and
 * development have genuinely different security postures, and keeping
 * them as distinct named policies makes it obvious (in code, in tests,
 * and in review) exactly what each one permits, rather than requiring a
 * reader to trace conditional string-building logic to find out.
 */

/**
 * The strict, packaged-app policy. No remote origins of any kind, no
 * inline or eval'd script execution. This is what every production
 * (file://) load of the renderer is served under — never weakened,
 * regardless of what development needs.
 *
 * style-src allows 'unsafe-inline' because the current static renderer
 * uses React inline style props; this does not permit script execution.
 */
export function buildProductionContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
}

const ALLOWED_DEV_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The development-only policy, used exclusively while running against
 * the local Vite dev server (electron-vite dev). Trusts exactly one
 * already-validated loopback origin — never a wildcard, never a remote
 * host — for both its HTTP and WebSocket forms:
 *
 * - script-src additionally allows 'unsafe-inline': Vite's React plugin
 *   injects an inline `<script type="module">` "preamble" that sets up
 *   React Refresh globals before any component module loads. There is no
 *   static nonce/hash to allow instead — the preamble's exact content is
 *   generated per dev session by Vite itself, outside LedgerPage's
 *   control. This is a development-only trade-off; it is never present
 *   in the production policy above.
 * - connect-src additionally allows the dev server's HTTP origin (for
 *   module fetches) and its WebSocket equivalent (for Vite's HMR client
 *   connection) — nothing else.
 *
 * `devServerOrigin` is expected to already be the validated result of
 * validateDevServerUrl (loopback-only, http-only, no credentials) — this
 * function additionally re-validates the hostname itself (defense in
 * depth: a CSP builder is exactly the kind of function that should fail
 * closed rather than trust a caller unconditionally) and throws rather
 * than silently building a policy that would trust a non-loopback
 * origin.
 */
export function buildDevelopmentContentSecurityPolicy(devServerOrigin: string): string {
  let parsed: URL
  try {
    parsed = new URL(devServerOrigin)
  } catch {
    throw new Error(`buildDevelopmentContentSecurityPolicy: not a valid URL: ${devServerOrigin}`)
  }

  if (!ALLOWED_DEV_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      `buildDevelopmentContentSecurityPolicy: refusing to trust non-loopback origin: ${devServerOrigin}`
    )
  }

  const httpOrigin = parsed.origin
  const wsOrigin = httpOrigin.replace(/^http/, 'ws')

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${httpOrigin}`,
    `connect-src 'self' ${httpOrigin} ${wsOrigin}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
}
