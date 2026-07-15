import { isNavigationAllowed, type NavigationPolicyContext } from './navigationPolicy'

/**
 * The minimal slice of Electron.IpcMainInvokeEvent this needs. A real
 * IpcMainInvokeEvent satisfies this structurally (WebFrameMain.url is a
 * string), so no cast is needed at the call site, and tests can pass a
 * plain fake instead of a real IPC event.
 */
export interface ApprovableIpcEvent {
  senderFrame: { url: string } | null
}

/**
 * Confirms an IPC sender's frame URL is our own approved renderer document
 * — the same rule that governs navigation. Not because app-info is
 * sensitive (it isn't), but to establish the sender-validation pattern
 * before any later handler that does carry sensitive data needs it.
 *
 * Rejects: a null/destroyed sender frame, any external https page, any
 * other file on disk, any unapproved origin.
 */
export function isApprovedIpcSender(
  event: ApprovableIpcEvent,
  context: NavigationPolicyContext
): boolean {
  const senderUrl = event.senderFrame?.url
  if (!senderUrl) {
    return false
  }
  return isNavigationAllowed(senderUrl, context)
}
