import { ipcMain } from 'electron'
import {
  LOGIN_ATTEMPT_CHANNEL,
  LOGIN_GET_SESSION_STATE_CHANNEL,
  LOGIN_LOGOUT_CHANNEL,
  LOGIN_TOUCH_CHANNEL,
  LOGIN_UNLOCK_CHANNEL,
  type LoginAttemptInput,
  type LoginResult,
  type SessionState,
  type UnlockInput,
  type UnlockResult
} from '../../shared/ipc/login'
import type { NavigationPolicyContext } from '../security/navigationPolicy'
import { isApprovedIpcSender, type ApprovableIpcEvent } from '../security/senderValidation'
import type { LoginService } from '../users/loginService'
import type { AppDb } from '../db/dbTypes'

class LoginIpcInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoginIpcInputError'
  }
}

function requireApprovedSender(event: ApprovableIpcEvent, context: NavigationPolicyContext): void {
  if (!isApprovedIpcSender(event, context)) {
    throw new Error('LedgerPage: rejected login request from an unapproved sender')
  }
}

function requireStringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new LoginIpcInputError(`${fieldName} must be a string`)
  }
  return value
}

function parseLoginAttemptInput(input: unknown): LoginAttemptInput {
  if (typeof input !== 'object' || input === null) {
    throw new LoginIpcInputError('login input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    loginIdentifier: requireStringField(candidate.loginIdentifier, 'loginIdentifier'),
    password: requireStringField(candidate.password, 'password')
  }
}

function parseUnlockInput(input: unknown): UnlockInput {
  if (typeof input !== 'object' || input === null) {
    throw new LoginIpcInputError('unlock input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return { password: requireStringField(candidate.password, 'password') }
}

export interface RegisterLoginHandlersOptions {
  context: NavigationPolicyContext
  db: AppDb
  loginService: LoginService
}

/**
 * Registers every Slice 9 login/session IPC handler. Every handler
 * validates the sender frame first and revalidates its own input
 * shape independently of anything the renderer already checked —
 * matching registerSetupHandlers.ts's established pattern exactly.
 *
 * No channel here accepts or returns a session id, a password hash, or
 * a raw exception message — every operation implicitly targets
 * whatever loginService considers "the current session," which the
 * renderer never sees or supplies.
 */
export function registerLoginHandlers(options: RegisterLoginHandlersOptions): void {
  const { context, db, loginService } = options

  ipcMain.handle(LOGIN_ATTEMPT_CHANNEL, async (event, rawInput: unknown): Promise<LoginResult> => {
    requireApprovedSender(event, context)
    let input: LoginAttemptInput
    try {
      input = parseLoginAttemptInput(rawInput)
    } catch {
      return { success: false }
    }
    return loginService.login(db, input.loginIdentifier, input.password)
  })

  ipcMain.handle(LOGIN_GET_SESSION_STATE_CHANNEL, (event): SessionState => {
    requireApprovedSender(event, context)
    // A pure read — must never itself count as user activity. See
    // loginService.getSessionState's own doc comment: it calls
    // sessionManager.get, never .touch.
    return loginService.getSessionState(db)
  })

  ipcMain.handle(LOGIN_UNLOCK_CHANNEL, async (event, rawInput: unknown): Promise<UnlockResult> => {
    requireApprovedSender(event, context)
    let input: UnlockInput
    try {
      input = parseUnlockInput(rawInput)
    } catch {
      return { success: false }
    }
    return loginService.unlock(db, input.password)
  })

  ipcMain.handle(LOGIN_LOGOUT_CHANNEL, (event): void => {
    requireApprovedSender(event, context)
    loginService.logout()
  })

  ipcMain.handle(LOGIN_TOUCH_CHANNEL, (event): void => {
    requireApprovedSender(event, context)
    loginService.touch(db)
  })
}
