/**
 * Shared IPC contract for Slice 8's first-run setup channels.
 *
 * Imported by the main process (to register handlers), the preload
 * script (to wrap them safely), and the renderer (to type the exposed
 * window.ledgerpage global) — the same three-way pattern
 * src/shared/ipc/appInfo.ts already established. Carries no database,
 * authentication-internal, or main-process-only types: every type here
 * is safe to serialize across contextBridge and safe for the renderer
 * to hold directly.
 *
 * Deliberately excluded from every result type below, on every
 * channel: a password hash, a recovery-key hash, the precomputed
 * Owner user id, or any raw internal exception message/stack trace.
 */

export const SETUP_GET_STATUS_CHANNEL = 'setup:get-status' as const
export const SETUP_PREPARE_RECOVERY_KEY_CHANNEL = 'setup:prepare-recovery-key' as const
export const SETUP_CONFIRM_RECOVERY_KEY_CHANNEL = 'setup:confirm-recovery-key' as const
export const SETUP_CANCEL_RECOVERY_KEY_CHANNEL = 'setup:cancel-recovery-key' as const
export const SETUP_COMPLETE_CHANNEL = 'setup:complete' as const

/**
 * Mirrors passwordHashing.ts's MIN_PASSWORD_LENGTH/MAX_PASSWORD_LENGTH
 * exactly, duplicated here rather than imported: that module pulls in
 * hash-wasm and Node-specific crypto, which must never be part of a
 * renderer bundle, even transitively through a shared constants file.
 * Covered by a direct-equality test against the authoritative main-
 * process values, so the two cannot silently drift apart unnoticed.
 */
export const SETUP_PASSWORD_MIN_LENGTH = 8
export const SETUP_PASSWORD_MAX_LENGTH = 256

export type FirstRunStatus =
  { status: 'setup_required' } | { status: 'setup_complete' } | { status: 'inconsistent_state' }

/**
 * `success: false` covers both "the underlying preparation itself
 * failed" and "this preparation became stale (superseded by a newer
 * one) before it could become usable" — either way, the renderer must
 * never be handed a ceremonyToken/plaintextRecoveryKey pair that has
 * already been invalidated.
 */
export type PrepareRecoveryKeyResult =
  { success: true; ceremonyToken: string; plaintextRecoveryKey: string } | { success: false }

export interface ConfirmRecoveryKeyInput {
  ceremonyToken: string
  reenteredKey: string
}

export type ConfirmRecoveryKeyResult = { success: true; commitToken: string } | { success: false }

export interface CancelRecoveryKeyInput {
  ceremonyToken: string
}

export interface SetupCompanyInput {
  name: string
  address: string
  contactDetails: string
}

export interface SetupOwnerInput {
  displayName: string
  loginIdentifier: string
  password: string
  passwordConfirmation: string
}

export interface CompleteSetupInput {
  company: SetupCompanyInput
  owner: SetupOwnerInput
  commitToken: string
}

export type SetupErrorCode =
  'setup_already_complete' | 'invalid_input' | 'recovery_confirmation_invalid' | 'unexpected_error'

export type CompleteSetupResult = { success: true } | { success: false; errorCode: SetupErrorCode }

/**
 * The full typed setup surface exposed to the renderer via
 * contextBridge. Keep this exactly in sync with what
 * src/preload/index.ts exposes — tests assert the two never drift
 * apart, the same discipline appInfo.ts's LedgerPageApi already
 * established.
 */
export interface LedgerPageSetupApi {
  getFirstRunStatus: () => Promise<FirstRunStatus>
  prepareRecoveryKey: () => Promise<PrepareRecoveryKeyResult>
  confirmRecoveryKey: (input: ConfirmRecoveryKeyInput) => Promise<ConfirmRecoveryKeyResult>
  cancelRecoveryKey: (input: CancelRecoveryKeyInput) => Promise<void>
  completeSetup: (input: CompleteSetupInput) => Promise<CompleteSetupResult>
}
