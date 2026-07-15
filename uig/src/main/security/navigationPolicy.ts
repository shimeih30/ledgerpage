/**
 * The single approved navigation target for this app: either the local
 * dev-server origin (development) or the exact renderer entry file
 * (production) — never both, never neither once main/index.ts computes it.
 */
export interface NavigationPolicyContext {
  devServerOrigin?: string
  productionEntryFileUrl?: string
}

/**
 * Decides whether an in-app navigation attempt (or IPC sender) should be
 * trusted.
 *
 * - Development: only same-origin navigation to the validated dev-server
 *   origin is allowed.
 * - Production: only the exact approved renderer entry file is allowed —
 *   compared by protocol + hostname + pathname, so a query string or hash
 *   change on that same document is still allowed (reload, in-app
 *   routing), but any other file:// path (a sibling file, /etc/passwd,
 *   any other file on disk, or a UNC-style file://some-host/... URL that
 *   happens to share the pathname but not the hostname) is rejected even
 *   though it shares the file: protocol.
 * - Anything else — malformed URLs, any other protocol, any other origin
 *   or path — is rejected.
 *
 * Pure and side-effect free so it can be unit tested directly; the Electron
 * event wiring lives in attachWindowSecurity.ts, and the same predicate is
 * reused for IPC sender validation in senderValidation.ts.
 */
export function isNavigationAllowed(targetUrl: string, context: NavigationPolicyContext): boolean {
  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return false
  }

  if (context.devServerOrigin) {
    try {
      const dev = new URL(context.devServerOrigin)
      return target.origin === dev.origin
    } catch {
      return false
    }
  }

  if (context.productionEntryFileUrl) {
    let approved: URL
    try {
      approved = new URL(context.productionEntryFileUrl)
    } catch {
      return false
    }
    return (
      target.protocol === 'file:' &&
      target.hostname === approved.hostname &&
      target.pathname === approved.pathname
    )
  }

  return false
}
