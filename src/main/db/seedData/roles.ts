/**
 * Fixed application reference data — the four approved roles. Stable
 * IDs, never random, matching Slice 4's reference-data convention.
 * Seeded idempotently by seedRoles.ts: an existing row (including one a
 * future admin screen has since edited — renamed, redescribed) is left
 * completely untouched.
 */

export interface RoleSeedRow {
  id: string
  code: string
  name: string
  description: string | null
}

export const roleSeedRows: RoleSeedRow[] = [
  {
    id: 'role_owner',
    code: 'owner',
    name: 'Owner',
    description: 'Full access to every defined action, including user and role management.'
  },
  {
    id: 'role_executive',
    code: 'executive',
    name: 'Executive',
    description:
      'Broad read access, including company, tax, and audit history, without user or role management.'
  },
  {
    id: 'role_operations',
    code: 'operations',
    name: 'Operations',
    description:
      'Operational read access for day-to-day work, without user, numbering, or tax management.'
  },
  {
    id: 'role_finance',
    code: 'finance',
    name: 'Finance',
    description:
      'Finance-related read and manage access, including tax configuration and audit history, without user management.'
  }
]
