/**
 * Builds the Content-Security-Policy header value for LedgerPage.
 *
 * Production is locked to 'self' everywhere with no unsafe-eval and no
 * remote origins of any kind. Development additionally trusts the local
 * Vite dev server origin (script + its websocket, for HMR) — never a
 * wildcard, never an arbitrary remote host.
 *
 * style-src allows 'unsafe-inline' because the current static renderer
 * uses React inline style props; this does not permit script execution.
 */
export function buildContentSecurityPolicy(devServerOrigin?: string): string {
  const scriptSrc = devServerOrigin ? `'self' ${devServerOrigin}` : "'self'"
  const connectSrc = devServerOrigin
    ? `'self' ${devServerOrigin} ${devServerOrigin.replace('http', 'ws')}`
    : "'self'"

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `connect-src ${connectSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
}
