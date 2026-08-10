import { describe, expect, it } from 'vitest'
import {
  ACTIONS,
  assertCan,
  AuthorizationError,
  can,
  ROLE_CODES
} from '../../../src/main/auth/authorizationService'

// The approved matrix, mirrored here as the source of truth for the test
// suite. Kept as plain data (not imported from the module under test) so
// this test would actually fail if the module's matrix silently drifted.
const EXPECTED_MATRIX: Record<(typeof ROLE_CODES)[number], readonly string[]> = {
  owner: [...ACTIONS],
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
    'inventory_lots.override',
    'accounts.read',
    'journal_entries.read'
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
    'inventory_lots.read',
    'accounts.read',
    'accounts.manage',
    'journal_entries.read',
    'journal_entries.manage'
  ]
}

describe('authorizationService', () => {
  it('every defined action is explicitly represented in ACTIONS', () => {
    expect(ACTIONS).toEqual([
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
      'inventory_lots.override',
      'accounts.read',
      'accounts.manage',
      'journal_entries.read',
      'journal_entries.manage'
    ])
  })

  it('owner receives every defined action', () => {
    for (const action of ACTIONS) {
      expect(can({ roleCodes: ['owner'] }, action)).toBe(true)
    }
  })

  it.each(ROLE_CODES)('role "%s" receives exactly its approved action subset', (roleCode) => {
    for (const action of ACTIONS) {
      const expected = EXPECTED_MATRIX[roleCode].includes(action)
      expect(can({ roleCodes: [roleCode] }, action)).toBe(expected)
    }
  })

  it('a principal with multiple roles is granted the union of their actions', () => {
    const principal = { roleCodes: ['operations', 'finance'] }
    expect(can(principal, 'numbering.read')).toBe(true) // operations
    expect(can(principal, 'tax.manage')).toBe(true) // finance
    expect(can(principal, 'company.update')).toBe(false) // neither
  })

  it('an unknown role code fails closed (grants nothing)', () => {
    expect(can({ roleCodes: ['superadmin'] }, 'company.read')).toBe(false)
  })

  it('a principal with no roles at all fails closed', () => {
    expect(can({ roleCodes: [] }, 'company.read')).toBe(false)
  })

  it('an unknown action fails closed even for the owner role', () => {
    expect(can({ roleCodes: ['owner'] }, 'inventory.manage')).toBe(false)
  })

  it('a mix of one known and one unknown role still grants the known role actions', () => {
    expect(can({ roleCodes: ['unknown_role', 'finance'] }, 'tax.manage')).toBe(true)
  })

  describe('assertCan', () => {
    it('does not throw when the principal is authorized', () => {
      expect(() => assertCan({ roleCodes: ['owner'] }, 'users.manage')).not.toThrow()
    })

    it('throws a controlled AuthorizationError when not authorized', () => {
      expect(() => assertCan({ roleCodes: ['operations'] }, 'users.manage')).toThrow(
        AuthorizationError
      )
    })

    it('throws AuthorizationError for an unknown action', () => {
      expect(() => assertCan({ roleCodes: ['owner'] }, 'not_a_real_action')).toThrow(
        AuthorizationError
      )
    })

    it('throws AuthorizationError for an unknown role', () => {
      expect(() => assertCan({ roleCodes: ['not_a_real_role'] }, 'company.read')).toThrow(
        AuthorizationError
      )
    })
  })
})
