import { isNavigationAllowed, type NavigationPolicyContext } from './navigationPolicy'

/**
 * The minimal slice of Electron.WebContents this module needs.
 * A real WebContents satisfies this structurally, so no cast is needed in
 * main/index.ts — and tests can pass a plain fake object instead of
 * launching Electron.
 */
export interface SecurableWebContents {
  on(
    event: 'will-navigate',
    listener: (event: { preventDefault: () => void }, url: string) => void
  ): void
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'deny' } | { action: 'allow' }
  ): void
}

/**
 * Blocks unexpected navigation and denies all new-window creation.
 * There is no approved use case yet for opening a second window or
 * navigating anywhere but the one approved renderer target, so both are
 * denied unconditionally rather than partially allow-listed.
 */
export function attachWindowSecurity(
  contents: SecurableWebContents,
  context: NavigationPolicyContext
): void {
  contents.on('will-navigate', (event, url) => {
    if (!isNavigationAllowed(url, context)) {
      event.preventDefault()
    }
  })

  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
