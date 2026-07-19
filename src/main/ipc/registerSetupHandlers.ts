import { ipcMain } from 'electron'
import {
  SETUP_CANCEL_RECOVERY_KEY_CHANNEL,
  SETUP_COMPLETE_CHANNEL,
  SETUP_CONFIRM_RECOVERY_KEY_CHANNEL,
  SETUP_GET_STATUS_CHANNEL,
  SETUP_PREPARE_RECOVERY_KEY_CHANNEL,
  type CancelRecoveryKeyInput,
  type CompleteSetupInput,
  type CompleteSetupResult,
  type ConfirmRecoveryKeyInput,
  type ConfirmRecoveryKeyResult,
  type FirstRunStatus,
  type PrepareRecoveryKeyResult
} from '../../shared/ipc/setup'
import type { NavigationPolicyContext } from '../security/navigationPolicy'
import { isApprovedIpcSender, type ApprovableIpcEvent } from '../security/senderValidation'
import { getFirstRunStatus } from '../setup/firstRunStatusService'
import type { FirstRunSetupService } from '../setup/firstRunSetupService'
import type { AppDb } from '../db/dbTypes'

class SetupIpcInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SetupIpcInputError'
  }
}

function requireApprovedSender(event: ApprovableIpcEvent, context: NavigationPolicyContext): void {
  if (!isApprovedIpcSender(event, context)) {
    throw new Error('LedgerPage: rejected setup request from an unapproved sender')
  }
}

/**
 * These checks accept an empty string deliberately — the real validation for "is this actually
 * a usable value" belongs to firstRunSetupService/userService/
 * companyValidation, which run again regardless. This layer only
 * confirms the IPC payload has the *shape* it claims to have (a
 * string, not undefined/null/a number/an object) before it's ever
 * passed further in — a renderer bug or a hand-crafted IPC call
 * sending the wrong shape must fail here with a clear, controlled
 * error, not produce a confusing failure two layers deeper.
 */
function requireStringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new SetupIpcInputError(`${fieldName} must be a string`)
  }
  return value
}

function parseConfirmRecoveryKeyInput(input: unknown): ConfirmRecoveryKeyInput {
  if (typeof input !== 'object' || input === null) {
    throw new SetupIpcInputError('confirmRecoveryKey input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    ceremonyToken: requireStringField(candidate.ceremonyToken, 'ceremonyToken'),
    reenteredKey: requireStringField(candidate.reenteredKey, 'reenteredKey')
  }
}

function parseCancelRecoveryKeyInput(input: unknown): CancelRecoveryKeyInput {
  if (typeof input !== 'object' || input === null) {
    throw new SetupIpcInputError('cancelRecoveryKey input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return { ceremonyToken: requireStringField(candidate.ceremonyToken, 'ceremonyToken') }
}

function parseCompleteSetupInput(input: unknown): CompleteSetupInput {
  if (typeof input !== 'object' || input === null) {
    throw new SetupIpcInputError('completeSetup input must be an object')
  }
  const candidate = input as Record<string, unknown>

  const companyCandidate = candidate.company
  if (typeof companyCandidate !== 'object' || companyCandidate === null) {
    throw new SetupIpcInputError('completeSetup input.company must be an object')
  }
  const companyFields = companyCandidate as Record<string, unknown>

  const ownerCandidate = candidate.owner
  if (typeof ownerCandidate !== 'object' || ownerCandidate === null) {
    throw new SetupIpcInputError('completeSetup input.owner must be an object')
  }
  const ownerFields = ownerCandidate as Record<string, unknown>

  return {
    company: {
      name: requireStringField(companyFields.name, 'company.name'),
      address: requireStringField(companyFields.address, 'company.address'),
      contactDetails: requireStringField(companyFields.contactDetails, 'company.contactDetails')
    },
    owner: {
      displayName: requireStringField(ownerFields.displayName, 'owner.displayName'),
      loginIdentifier: requireStringField(ownerFields.loginIdentifier, 'owner.loginIdentifier'),
      password: requireStringField(ownerFields.password, 'owner.password'),
      passwordConfirmation: requireStringField(
        ownerFields.passwordConfirmation,
        'owner.passwordConfirmation'
      )
    },
    commitToken: requireStringField(candidate.commitToken, 'commitToken')
  }
}

/**
 * Maps firstRunStatusService's internal result (which carries a
 * `reason` string intended for main-process diagnostics only) to the
 * shared, renderer-safe shape — `reason` never crosses this boundary,
 * regardless of how descriptive or seemingly-harmless it looks; the
 * renderer gets only the fixed `inconsistent_state` tag and decides
 * what to show from that alone.
 */
function toSafeFirstRunStatus(db: AppDb): FirstRunStatus {
  const result = getFirstRunStatus(db)
  if (result.status === 'inconsistent_state') {
    return { status: 'inconsistent_state' }
  }
  return { status: result.status }
}

export interface RegisterSetupHandlersOptions {
  context: NavigationPolicyContext
  db: AppDb
  setupService: FirstRunSetupService
}

/**
 * Registers every Slice 8 setup IPC handler. Every handler validates
 * the sender frame first (matching registerAppInfoHandler's
 * established pattern) and revalidates its own input shape
 * independently of anything the renderer already checked — per the
 * explicit "renderer validation alone is not trusted" requirement.
 *
 * Never exposed here, on any channel: a database handle, arbitrary
 * SQL, filesystem access, a password hash, a recovery hash, role
 * mutation outside the one fixed Owner-creation path, a general user-
 * management API, raw session mutation, or a way to invoke anything in
 * the main process beyond these five fixed, narrow operations.
 */
export function registerSetupHandlers(options: RegisterSetupHandlersOptions): void {
  const { context, db, setupService } = options

  ipcMain.handle(SETUP_GET_STATUS_CHANNEL, (event): FirstRunStatus => {
    requireApprovedSender(event, context)
    return toSafeFirstRunStatus(db)
  })

  function requireSetupStillRequired(): void {
    if (getFirstRunStatus(db).status !== 'setup_required') {
      throw new Error('LedgerPage: setup is not required — refusing this setup mutation')
    }
  }

  ipcMain.handle(
    SETUP_PREPARE_RECOVERY_KEY_CHANNEL,
    async (event): Promise<PrepareRecoveryKeyResult> => {
      requireApprovedSender(event, context)
      requireSetupStillRequired()
      return setupService.prepareRecoveryKey()
    }
  )

  ipcMain.handle(
    SETUP_CONFIRM_RECOVERY_KEY_CHANNEL,
    async (event, rawInput: unknown): Promise<ConfirmRecoveryKeyResult> => {
      requireApprovedSender(event, context)
      requireSetupStillRequired()
      const input = parseConfirmRecoveryKeyInput(rawInput)

      const confirmed = await setupService.confirmRecoveryKey(
        input.ceremonyToken,
        input.reenteredKey
      )
      if (!confirmed) {
        return { success: false }
      }
      return { success: true, commitToken: confirmed.commitToken }
    }
  )

  ipcMain.handle(SETUP_CANCEL_RECOVERY_KEY_CHANNEL, (event, rawInput: unknown): void => {
    requireApprovedSender(event, context)
    // Deliberately no requireSetupStillRequired() here — cancelling
    // an in-memory ceremony is harmless in every database state (it
    // never touches SQLite), and refusing it after setup completes
    // would only prevent tidying up a ceremony that's already
    // inert.
    const input = parseCancelRecoveryKeyInput(rawInput)
    setupService.cancelRecoveryKey(input.ceremonyToken)
  })

  ipcMain.handle(
    SETUP_COMPLETE_CHANNEL,
    async (event, rawInput: unknown): Promise<CompleteSetupResult> => {
      requireApprovedSender(event, context)

      let input: CompleteSetupInput
      try {
        input = parseCompleteSetupInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      return setupService.completeSetup(db, input.company, input.owner, input.commitToken)
    }
  )
}
