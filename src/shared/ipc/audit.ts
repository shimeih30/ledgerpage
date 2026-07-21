/**
 * Shared IPC contract for Slice 10's single audit-viewing channel.
 *
 * Deliberately read-only: there is exactly one channel
 * (AUDIT_LIST_CHANNEL) and no representable way to construct a request
 * that updates or deletes an entry — no such input type, no such result
 * type, no such channel constant exists anywhere in this file. Audit
 * rows are append-only at every layer, not merely by convention at one
 * of them.
 *
 * Bounded cursor pagination (never the complete table): `cursor`
 * encodes the last-seen row's (occurredAt, id) pair — id is included
 * because occurredAt alone is not guaranteed unique (two entries in the
 * same transaction can share a millisecond timestamp). `limit` has a
 * default and a hard maximum, both enforced server-side in the main
 * process regardless of what a caller requests — see
 * registerAuditHandlers.ts.
 */

export const AUDIT_LIST_CHANNEL = 'audit:list' as const

export type AuditActorType = 'user' | 'system'
export type AuditAction = 'create' | 'update' | 'deactivate' | 'reactivate'

export interface SafeFieldChange {
  old: unknown
  new: unknown
}

/**
 * Already redacted by the time this ever reaches the renderer —
 * auditService.record() redacts before the row is ever written, so
 * there is no unredacted value anywhere upstream of this type. Secret-
 * like values appear here as the fixed '[redacted]' placeholder string,
 * never the original.
 */
export type SafeChangedFields = Record<string, SafeFieldChange>

export interface SafeAuditLogEntry {
  id: string
  entityType: string
  entityId: string
  entityLabel: string
  action: AuditAction
  changedFields: SafeChangedFields | null
  actorType: AuditActorType
  userId: string | null
  /**
   * Resolved server-side, never supplied by or trusted from the
   * renderer: 'System' for a system actor, the user's current
   * displayName for a user actor, or 'Unknown user' in the defensive,
   * expected-unreachable case of a missing referenced user row.
   */
  actorLabel: string
  companyId: string | null
  /** Epoch milliseconds — never a Date object over this boundary, matching cursor's own shape. */
  occurredAt: number
}

export interface AuditCursor {
  occurredAt: number
  id: string
}

export interface ListAuditEntriesInput {
  entityType?: string
  fromOccurredAt?: number
  toOccurredAt?: number
  limit?: number
  cursor?: AuditCursor
}

export type AuditErrorCode =
  'invalid_input' | 'session_invalid' | 'not_authorized' | 'unexpected_error'

export type ListAuditEntriesResult =
  | { success: true; entries: SafeAuditLogEntry[]; nextCursor?: AuditCursor }
  | { success: false; errorCode: AuditErrorCode }

export interface LedgerPageAuditApi {
  listAuditEntries: (input: ListAuditEntriesInput) => Promise<ListAuditEntriesResult>
}
