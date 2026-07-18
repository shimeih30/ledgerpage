/**
 * The typed initial action set needed by Slices 8-10. Deliberately does
 * not invent later inventory/sales/accounting permissions — extending
 * this set is a normal, expected part of each future slice that
 * introduces a new domain.
 */
export const ACTIONS = [
  'first_run.complete',
  'users.read',
  'users.manage',
  'roles.read',
  'company.read',
  'company.update',
  'numbering.read',
  'numbering.update',
  'tax.read',
  'tax.manage',
  'audit.read'
] as const

export type Action = (typeof ACTIONS)[number]

export const ROLE_CODES = ['owner', 'executive', 'operations', 'finance'] as const
export type RoleCode = (typeof ROLE_CODES)[number]

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthorizationError'
  }
}

/**
 * Anything with a roleCodes array can be an authorization principal —
 * deliberately not tied to SessionSnapshot or SafeUser's exact shape, to
 * avoid a coupling between this module and either of theirs. A
 * SessionSnapshot already satisfies this structurally.
 */
export interface AuthPrincipal {
  roleCodes: readonly string[]
}

/**
 * The approved role-to-action matrix. Kept minimal and explicitly
 * revisitable — two of the four rows resolve ambiguity in the approved
 * baseline description with a documented, conservative interpretation
 * rather than guessing generously:
 *
 * - executive: "broad read access and company/tax/audit read access,
 *   but no user or role management" only explicitly names company/tax/
 *   audit reads (plus numbering, judged to fall under "broad read
 *   access" as ordinary operational-config visibility). It does NOT
 *   explicitly grant users.read or roles.read, and — since "no user or
 *   role management" leaves read access ambiguous — this matrix takes
 *   the conservative reading and withholds both rather than assuming
 *   read access was intended but left unstated.
 * - operations: "operational read access only; no users, numbering or
 *   tax management" is read here as granting numbering.read
 *   specifically (the most directly "operational" of the actions this
 *   slice defines — day-to-day document numbering), and nothing else,
 *   since no other operational actions exist yet in this action set.
 *
 * owner always receives every defined action, computed from ACTIONS
 * rather than hand-duplicated, so a newly added action is automatically
 * granted to owner without this file needing a matching edit.
 */
const NON_OWNER_ROLE_ACTIONS: Record<Exclude<RoleCode, 'owner'>, readonly Action[]> = {
  executive: ['company.read', 'numbering.read', 'tax.read', 'audit.read'],
  operations: ['numbering.read'],
  finance: ['company.read', 'numbering.read', 'tax.read', 'tax.manage', 'audit.read']
}

const ROLE_ACTION_MATRIX: Record<RoleCode, ReadonlySet<Action>> = {
  owner: new Set(ACTIONS),
  executive: new Set(NON_OWNER_ROLE_ACTIONS.executive),
  operations: new Set(NON_OWNER_ROLE_ACTIONS.operations),
  finance: new Set(NON_OWNER_ROLE_ACTIONS.finance)
}

function isKnownAction(action: string): action is Action {
  return (ACTIONS as readonly string[]).includes(action)
}

function isKnownRoleCode(roleCode: string): roleCode is RoleCode {
  return (ROLE_CODES as readonly string[]).includes(roleCode)
}

/**
 * True if any role held by `principal` grants `action`. An unknown
 * action or an unknown/unrecognized role code fails closed (returns
 * false) rather than throwing or silently skipping — a principal whose
 * every role is unrecognized is simply granted nothing.
 */
export function can(principal: AuthPrincipal, action: string): boolean {
  if (!isKnownAction(action)) {
    return false
  }

  for (const roleCode of principal.roleCodes) {
    if (isKnownRoleCode(roleCode) && ROLE_ACTION_MATRIX[roleCode].has(action)) {
      return true
    }
  }

  return false
}

export function assertCan(principal: AuthPrincipal, action: string): void {
  if (!can(principal, action)) {
    throw new AuthorizationError(
      `Principal with roles [${principal.roleCodes.join(', ')}] is not authorized for action "${action}"`
    )
  }
}
