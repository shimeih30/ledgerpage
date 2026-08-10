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
  'audit.read',
  'products.read',
  'products.manage',
  'inventory_items.read',
  'inventory_items.manage',
  'suppliers.read',
  'suppliers.manage',
  'customers.read',
  'customers.manage',
  'inventory_lots.read',
  'inventory_lots.manage',
  'inventory_lots.override'
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
 * Slice 11 (products.read/products.manage): owner, executive, and
 * operations all receive both — the first case in this matrix where
 * executive and operations hold a "manage" (write) action, per the
 * plan's explicit "Operations/Executive edit access." finance receives
 * neither — the plan names only Operations/Executive, and per this same
 * conservative-reading convention, an unstated capability (e.g. finance
 * needing product visibility for costing context) is not assumed.
 *
 * Slice 12 (inventory_items.read/inventory_items.manage): approved
 * decision mirrors Slice 11's matrix exactly — owner, executive, and
 * operations all receive both; finance receives inventory_items.read
 * only.
 *
 * Slice 13 (suppliers.read/suppliers.manage): approved decision departs
 * from Slices 11/12's pattern deliberately — ALL FOUR roles, including
 * finance, receive both actions. Unlike products/inventory items,
 * supplier and supplier-item pricing data is explicitly named financial
 * master data in the approved decision, so finance's usual read-only
 * posture on master-data domains does not apply here; finance manages
 * suppliers and supplier pricing directly. This action pair is also
 * reused, unchanged, for supplier_item_prices — there is no separate
 * action for price recording, mirroring how product_variants reuses
 * products.read/products.manage directly rather than having its own
 * pair.
 *
 * Slice 14 (customers.read/customers.manage): approved decision mirrors
 * Slice 13's all-four-roles pattern — owner, executive, operations, and
 * finance all receive both. This action pair is also reused, unchanged,
 * for customer_contacts — there is no separate action for contact
 * management, mirroring supplier_item_prices' own precedent.
 *
 * Slice 15 (inventory_lots.read/inventory_lots.manage/
 * inventory_lots.override): a three-tier matrix distinct from every
 * prior domain — owner and executive receive all three; operations
 * receives read/manage but NOT override (operations may not bypass the
 * expired/quarantined-lot consumption guard); finance receives read
 * only (unlike suppliers/customers, stock lots are physical-inventory
 * mechanics, not financial master data finance directly manages).
 * inventory_lots.override is deliberately its own action, separate from
 * .manage, so a role can manage lots without being able to override the
 * negative-stock/expiry/quarantine guards.
 *
 * owner always receives every defined action, computed from ACTIONS
 * rather than hand-duplicated, so a newly added action is automatically
 * granted to owner without this file needing a matching edit.
 */
const NON_OWNER_ROLE_ACTIONS: Record<Exclude<RoleCode, 'owner'>, readonly Action[]> = {
  executive: [
    'company.read',
    'numbering.read',
    'tax.read',
    'audit.read',
    'products.read',
    'products.manage',
    'inventory_items.read',
    'inventory_items.manage',
    'suppliers.read',
    'suppliers.manage',
    'customers.read',
    'customers.manage',
    'inventory_lots.read',
    'inventory_lots.manage',
    'inventory_lots.override'
  ],
  operations: [
    'numbering.read',
    'products.read',
    'products.manage',
    'inventory_items.read',
    'inventory_items.manage',
    'suppliers.read',
    'suppliers.manage',
    'customers.read',
    'customers.manage',
    'inventory_lots.read',
    'inventory_lots.manage'
  ],
  finance: [
    'company.read',
    'numbering.read',
    'tax.read',
    'tax.manage',
    'audit.read',
    'products.read',
    'inventory_items.read',
    'suppliers.read',
    'suppliers.manage',
    'customers.read',
    'customers.manage',
    'inventory_lots.read'
  ]
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
