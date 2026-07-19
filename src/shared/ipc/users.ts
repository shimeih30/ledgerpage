/**
 * Shared IPC contract for Slice 9's user-management channels — the
 * Owner-only Users & Roles surface.
 *
 * `roleCode` on the create-user input is typed as NonOwnerRoleCode,
 * not `string` — 'owner' is not a representable value here, matching
 * userManagementService.ts's own type. Slice 8's "exactly one Owner"
 * invariant is preserved by construction at every layer, not merely
 * checked at one of them.
 */

export const USERS_LIST_CHANNEL = 'users:list' as const
export const USERS_CREATE_CHANNEL = 'users:create' as const
export const USERS_DEACTIVATE_CHANNEL = 'users:deactivate' as const
export const USERS_REACTIVATE_CHANNEL = 'users:reactivate' as const
export const ROLES_LIST_ASSIGNABLE_CHANNEL = 'roles:list-assignable' as const

export type NonOwnerRoleCode = 'executive' | 'operations' | 'finance'

export interface SafeUserListItem {
  id: string
  loginIdentifier: string
  displayName: string
  isActive: boolean
  /**
   * Includes 'owner' for display purposes (the Owner appears in this
   * same list, read-only) even though 'owner' can never be *assigned*
   * through createUser below. Null only in the structurally-impossible
   * case of a user with no role assignment at all.
   */
  roleCode: string | null
}

export type UsersErrorCode =
  | 'not_authorized'
  | 'invalid_input'
  | 'duplicate_login_identifier'
  | 'cannot_modify_owner'
  | 'session_invalid'
  | 'unexpected_error'

export type ListUsersResult =
  { success: true; users: SafeUserListItem[] } | { success: false; errorCode: UsersErrorCode }

export interface CreateUserInput {
  displayName: string
  loginIdentifier: string
  password: string
  passwordConfirmation: string
  roleCode: NonOwnerRoleCode
}

export type CreateUserResult = { success: true } | { success: false; errorCode: UsersErrorCode }

export interface UserIdInput {
  userId: string
}

export type MutateUserResult = { success: true } | { success: false; errorCode: UsersErrorCode }

export interface AssignableRole {
  code: NonOwnerRoleCode
  name: string
}

export type ListAssignableRolesResult =
  { success: true; roles: AssignableRole[] } | { success: false; errorCode: UsersErrorCode }

export interface LedgerPageUsersApi {
  listUsers: () => Promise<ListUsersResult>
  createUser: (input: CreateUserInput) => Promise<CreateUserResult>
  deactivateUser: (input: UserIdInput) => Promise<MutateUserResult>
  reactivateUser: (input: UserIdInput) => Promise<MutateUserResult>
  listAssignableRoles: () => Promise<ListAssignableRolesResult>
}
