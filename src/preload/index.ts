import { contextBridge, ipcRenderer } from 'electron'
import { APP_INFO_CHANNEL, type AppInfo, type LedgerPageApi } from '../shared/ipc/appInfo'
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
  type LedgerPageSetupApi,
  type PrepareRecoveryKeyResult
} from '../shared/ipc/setup'
import {
  LOGIN_ATTEMPT_CHANNEL,
  LOGIN_GET_SESSION_STATE_CHANNEL,
  LOGIN_LOGOUT_CHANNEL,
  LOGIN_TOUCH_CHANNEL,
  LOGIN_UNLOCK_CHANNEL,
  type LedgerPageLoginApi,
  type LoginAttemptInput,
  type LoginResult,
  type SessionState,
  type UnlockInput,
  type UnlockResult
} from '../shared/ipc/login'
import {
  ROLES_LIST_ASSIGNABLE_CHANNEL,
  USERS_CREATE_CHANNEL,
  USERS_DEACTIVATE_CHANNEL,
  USERS_LIST_CHANNEL,
  USERS_REACTIVATE_CHANNEL,
  type CreateUserInput,
  type CreateUserResult,
  type LedgerPageUsersApi,
  type ListAssignableRolesResult,
  type ListUsersResult,
  type MutateUserResult,
  type UserIdInput
} from '../shared/ipc/users'
import {
  AUDIT_LIST_CHANNEL,
  type LedgerPageAuditApi,
  type ListAuditEntriesInput,
  type ListAuditEntriesResult
} from '../shared/ipc/audit'

/**
 * The entire renderer-facing API for LedgerPage.
 *
 * getAppInfo: proves the contextBridge pattern works end to end, not
 * real application capability (Slice 2).
 *
 * The five setup:* methods are Slice 8's narrow, immutable first-run
 * surface.
 *
 * The five login:* methods and the users/roles methods are Slice 9's
 * narrow surface. No channel here accepts or returns a session id —
 * every login/session operation implicitly targets whatever the main
 * process considers "the current session"; the renderer never sees or
 * supplies one. Every users/roles mutation is re-authorized fresh,
 * server-side, from live SQLite role data on every call — this preload
 * layer carries no isOwner flag of its own and grants nothing by
 * itself.
 *
 * listAuditEntries is Slice 10's one, read-only method. Like every
 * users/roles call above, it is re-authorized fresh, server-side, on
 * every single call — this preload layer's session.canViewAuditLog
 * (used only to decide whether the renderer *shows* an Audit Log link)
 * carries no authority of its own and is never consulted by the actual
 * handler.
 *
 * Deliberately absent, on every one of these: a database handle,
 * arbitrary SQL, filesystem access, a password hash, a recovery hash,
 * a session id, unrestricted role mutation (no channel can grant or
 * remove the Owner role), a way to update or delete an audit entry, or
 * any way to invoke anything else in the main process. Do not add
 * additional keys here without updating the corresponding shared/ipc
 * source file and its tests.
 */
const api: LedgerPageApi &
  LedgerPageSetupApi &
  LedgerPageLoginApi &
  LedgerPageUsersApi &
  LedgerPageAuditApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL),

  getFirstRunStatus: (): Promise<FirstRunStatus> => ipcRenderer.invoke(SETUP_GET_STATUS_CHANNEL),

  prepareRecoveryKey: (): Promise<PrepareRecoveryKeyResult> =>
    ipcRenderer.invoke(SETUP_PREPARE_RECOVERY_KEY_CHANNEL),

  confirmRecoveryKey: (input: ConfirmRecoveryKeyInput): Promise<ConfirmRecoveryKeyResult> =>
    ipcRenderer.invoke(SETUP_CONFIRM_RECOVERY_KEY_CHANNEL, input),

  cancelRecoveryKey: (input: CancelRecoveryKeyInput): Promise<void> =>
    ipcRenderer.invoke(SETUP_CANCEL_RECOVERY_KEY_CHANNEL, input),

  completeSetup: (input: CompleteSetupInput): Promise<CompleteSetupResult> =>
    ipcRenderer.invoke(SETUP_COMPLETE_CHANNEL, input),

  login: (input: LoginAttemptInput): Promise<LoginResult> =>
    ipcRenderer.invoke(LOGIN_ATTEMPT_CHANNEL, input),

  getSessionState: (): Promise<SessionState> => ipcRenderer.invoke(LOGIN_GET_SESSION_STATE_CHANNEL),

  unlockSession: (input: UnlockInput): Promise<UnlockResult> =>
    ipcRenderer.invoke(LOGIN_UNLOCK_CHANNEL, input),

  logout: (): Promise<void> => ipcRenderer.invoke(LOGIN_LOGOUT_CHANNEL),

  touchSession: (): Promise<void> => ipcRenderer.invoke(LOGIN_TOUCH_CHANNEL),

  listUsers: (): Promise<ListUsersResult> => ipcRenderer.invoke(USERS_LIST_CHANNEL),

  createUser: (input: CreateUserInput): Promise<CreateUserResult> =>
    ipcRenderer.invoke(USERS_CREATE_CHANNEL, input),

  deactivateUser: (input: UserIdInput): Promise<MutateUserResult> =>
    ipcRenderer.invoke(USERS_DEACTIVATE_CHANNEL, input),

  reactivateUser: (input: UserIdInput): Promise<MutateUserResult> =>
    ipcRenderer.invoke(USERS_REACTIVATE_CHANNEL, input),

  listAssignableRoles: (): Promise<ListAssignableRolesResult> =>
    ipcRenderer.invoke(ROLES_LIST_ASSIGNABLE_CHANNEL),

  listAuditEntries: (input: ListAuditEntriesInput): Promise<ListAuditEntriesResult> =>
    ipcRenderer.invoke(AUDIT_LIST_CHANNEL, input)
}

contextBridge.exposeInMainWorld('ledgerpage', api)
