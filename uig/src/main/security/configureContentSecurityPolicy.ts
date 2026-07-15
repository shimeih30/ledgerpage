import { buildContentSecurityPolicy } from './contentSecurityPolicy'

/**
 * The minimal slice of Electron.Session this module needs.
 * A real Session satisfies this structurally.
 */
export interface CspConfigurableSession {
  webRequest: {
    onHeadersReceived(
      listener: (
        details: { responseHeaders?: Record<string, string[]> },
        callback: (response: { responseHeaders: Record<string, string[]> }) => void
      ) => void
    ): void
  }
}

/**
 * Injects a strict Content-Security-Policy header into every response this
 * session handles, covering both the packaged file:// renderer and (in
 * development) the local Vite dev server.
 *
 * Any pre-existing Content-Security-Policy header is removed first,
 * case-insensitively (HTTP header names are case-insensitive, but plain
 * JS object keys are not — 'content-security-policy' and
 * 'Content-Security-Policy' would otherwise coexist as two distinct keys
 * and be sent to the browser as duplicate headers). Every other header is
 * preserved untouched.
 */
export function configureContentSecurityPolicy(
  session: CspConfigurableSession,
  devServerOrigin?: string
): void {
  const csp = buildContentSecurityPolicy(devServerOrigin)

  session.webRequest.onHeadersReceived((details, callback) => {
    const existingHeaders = details.responseHeaders ?? {}
    const preservedHeaders: Record<string, string[]> = {}

    for (const [name, value] of Object.entries(existingHeaders)) {
      if (name.toLowerCase() !== 'content-security-policy') {
        preservedHeaders[name] = value
      }
    }

    callback({
      responseHeaders: {
        ...preservedHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}
