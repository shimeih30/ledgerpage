/**
 * Validates the local Vite dev-server URL before it is trusted anywhere in
 * the app (loadURL, CSP construction, navigation allow-listing).
 *
 * process.env.ELECTRON_RENDERER_URL is set by our own dev tooling, but it
 * is still an environment value, not a constant — this fails closed on
 * anything that doesn't look like exactly what electron-vite's dev server
 * actually serves.
 */

export interface ValidatedDevServerUrl {
  /** The fully parsed, normalized URL object. */
  url: URL
  /** The normalized origin string, e.g. "http://localhost:5173". */
  origin: string
}

const ALLOWED_DEV_PROTOCOLS = new Set(['http:'])
const ALLOWED_DEV_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * @param rawValue - process.env.ELECTRON_RENDERER_URL, untrusted.
 * @param isPackaged - app.isPackaged. When true, the dev URL is never
 *   considered, regardless of its value — packaged builds always loadFile.
 */
export function validateDevServerUrl(
  rawValue: string | undefined,
  isPackaged: boolean
): ValidatedDevServerUrl | undefined {
  if (isPackaged) {
    return undefined
  }

  if (!rawValue) {
    return undefined
  }

  let url: URL
  try {
    url = new URL(rawValue)
  } catch {
    return undefined
  }

  // Rejects javascript:, data:, file:, https: (no concrete local-dev need
  // for https yet — add it deliberately, with a reason, if that changes).
  if (!ALLOWED_DEV_PROTOCOLS.has(url.protocol)) {
    return undefined
  }

  // Rejects http://user:pass@host style credentials in the URL.
  if (url.username || url.password) {
    return undefined
  }

  if (!ALLOWED_DEV_HOSTNAMES.has(url.hostname.toLowerCase())) {
    return undefined
  }

  return { url, origin: url.origin }
}
