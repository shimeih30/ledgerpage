import { ipcMain } from 'electron'
import {
  ROLES_LIST_ASSIGNABLE_CHANNEL,
  USERS_CREATE_CHANNEL,
  USERS_DEACTIVATE_CHANNEL,
  USERS_LIST_CHANNEL,
  USERS_REACTIVATE_CHANNEL,
  type CreateUserResult,
  type ListAssignableRolesResult,
  type ListUsersResult,
  type MutateUserResult,
  type NonOwnerRoleCode,
  type UserIdInput,
  type UsersErrorCode
} from '../../shared/ipc/users'
import type { NavigationPolicyContext } from '../security/navigationPolicy'
import { isApprovedIpcSender, type ApprovableIpcEvent } from '../security/senderValidation'
import {
  type CreateAdditionalUserInput,
  type UserManagementErrorCode,
  type UserManagementService
} from '../users/userManagementService'
import type { AppDb } from '../db/dbTypes'

const ASSIGNABLE_ROLE_NAMES: Record<NonOwnerRoleCode, string> = {
  executive: 'Executive',
  operations: 'Operations',
  finance: 'Finance'
}

class UsersIpcInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsersIpcInputError'
  }
}

function requireApprovedSender(event: ApprovableIpcEvent, context: NavigationPolicyContext): void {
  if (!isApprovedIpcSender(event, context)) {
    throw new Error('LedgerPage: rejected users request from an unapproved sender')
  }
}

function requireStringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new UsersIpcInputError(`${fieldName} must be a string`)
  }
  return value
}

function parseCreateUserInput(input: unknown): CreateAdditionalUserInput {
  if (typeof input !== 'object' || input === null) {
    throw new UsersIpcInputError('createUser input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    displayName: requireStringField(candidate.displayName, 'displayName'),
    loginIdentifier: requireStringField(candidate.loginIdentifier, 'loginIdentifier'),
    password: requireStringField(candidate.password, 'password'),
    passwordConfirmation: requireStringField(
      candidate.passwordConfirmation,
      'passwordConfirmation'
    ),
    // Deliberately not narrowed to NonOwnerRoleCode here — this layer
    // only confirms the payload has the right *shape* (a string). An
    // out-of-range value (including 'owner') is passed through
    // unchanged and rejected by userManagementService's own value
    // check, mapped to the same invalid_input code a malformed string
    // would get — two independent checks, not one, matching this
    // codebase's layered-validation posture.
    roleCode: requireStringField(candidate.roleCode, 'roleCode')
  }
}

function parseUserIdInput(input: unknown): UserIdInput {
  if (typeof input !== 'object' || input === null) {
    throw new UsersIpcInputError('input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return { userId: requireStringField(candidate.userId, 'userId') }
}

/**
 * userManagementService's own UserManagementErrorCode and the shared
 * IPC UsersErrorCode are structurally identical by design (mirroring
 * Slice 8's firstRunSetupService/shared-setup-types relationship) —
 * this mapping keeps the two independently defined, so the service
 * layer never depends on the IPC-boundary type module.
 */
function toSharedErrorCode(code: UserManagementErrorCode): UsersErrorCode {
  return code
}

export interface RegisterUserManagementHandlersOptions {
  context: NavigationPolicyContext
  db: AppDb
  userManagementService: UserManagementService
}

/**
 * Registers every Slice 9 user-management IPC handler. Every mutating
 * handler here is gated by userManagementService's own fresh,
 * SQLite-sourced authorization check (never a renderer-supplied
 * isOwner flag, never session-cached role codes) — this IPC layer only
 * adds sender validation and input-shape parsing on top, exactly like
 * every other handler file in this codebase.
 *
 * Never exposed here: a password hash, arbitrary SQL, a way to assign
 * or remove the Owner role, or a raw exception message.
 */
export function registerUserManagementHandlers(
  options: RegisterUserManagementHandlersOptions
): void {
  const { context, db, userManagementService } = options

  ipcMain.handle(USERS_LIST_CHANNEL, (event): ListUsersResult => {
    requireApprovedSender(event, context)
    const outcome = userManagementService.listUsers(db)
    if (!outcome.success) {
      return { success: false, errorCode: toSharedErrorCode(outcome.errorCode) }
    }
    return { success: true, users: outcome.users }
  })

  ipcMain.handle(
    USERS_CREATE_CHANNEL,
    async (event, rawInput: unknown): Promise<CreateUserResult> => {
      requireApprovedSender(event, context)
      let input: CreateAdditionalUserInput
      try {
        input = parseCreateUserInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }
      const outcome = await userManagementService.createAdditionalUser(db, input)
      if (!outcome.success) {
        return { success: false, errorCode: toSharedErrorCode(outcome.errorCode) }
      }
      return { success: true }
    }
  )

  ipcMain.handle(USERS_DEACTIVATE_CHANNEL, (event, rawInput: unknown): MutateUserResult => {
    requireApprovedSender(event, context)
    let input: UserIdInput
    try {
      input = parseUserIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }
    const outcome = userManagementService.deactivateAdditionalUser(db, input.userId)
    if (!outcome.success) {
      return { success: false, errorCode: toSharedErrorCode(outcome.errorCode) }
    }
    return { success: true }
  })

  ipcMain.handle(USERS_REACTIVATE_CHANNEL, (event, rawInput: unknown): MutateUserResult => {
    requireApprovedSender(event, context)
    let input: UserIdInput
    try {
      input = parseUserIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }
    const outcome = userManagementService.reactivateAdditionalUser(db, input.userId)
    if (!outcome.success) {
      return { success: false, errorCode: toSharedErrorCode(outcome.errorCode) }
    }
    return { success: true }
  })

  ipcMain.handle(ROLES_LIST_ASSIGNABLE_CHANNEL, (event): ListAssignableRolesResult => {
    requireApprovedSender(event, context)
    const outcome = userManagementService.listAssignableRoles(db)
    if (!outcome.success) {
      return { success: false, errorCode: toSharedErrorCode(outcome.errorCode) }
    }
    return {
      success: true,
      roles: outcome.roleCodes.map((code) => ({ code, name: ASSIGNABLE_ROLE_NAMES[code] }))
    }
  })
}
