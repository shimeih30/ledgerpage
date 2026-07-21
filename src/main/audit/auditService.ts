import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, lt, lte, or } from 'drizzle-orm'
import { auditLogEntries, users } from '../db/schema'
import type { AppDb, AppTransaction } from '../db/dbTypes'

export type AuditActorType = 'user' | 'system'
export type AuditAction = 'create' | 'update' | 'deactivate' | 'reactivate'

/**
 * No default anywhere in this module — every call site must supply one
 * explicitly. A silent default to 'system' would misattribute a real,
 * authenticated user's action as having no actor, which is exactly the
 * failure this type's shape is designed to make unrepresentable: there
 * is no way to construct an AuditActor without deciding which variant it
 * is.
 */
export type AuditActor = { type: 'user'; userId: string } | { type: 'system' }

export interface FieldChange {
  old: unknown
  new: unknown
}

/**
 * Thrown when a stored changed_fields JSON blob fails validation on
 * read. Never exposed to a renderer directly — the IPC handler layer
 * (registerAuditHandlers.ts) already catches any exception from
 * listEntries and maps it to a fixed, safe errorCode, never forwarding
 * this error's own message.
 */
export class AuditServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuditServiceError'
  }
}

const UNSAFE_CHANGED_FIELD_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/**
 * True only for a genuine plain object — excludes null, arrays, and
 * anything JSON.parse could never itself produce (Date, class
 * instances, etc.), though the latter is already unreachable here
 * given the input always originates from JSON.parse.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

/**
 * Recursively validates an arbitrary JSON-compatible value, rejecting
 * __proto__, prototype, and constructor as an object key at *any*
 * depth — not just a changed-field's own top-level name, but any key
 * nested inside old or new, however deep: inside a nested object,
 * inside an array, inside an object inside an array, and so on.
 * Primitives (string, number, boolean) and null are valid as-is at any
 * position; an array is valid when every element independently is.
 * JSON.parse can only ever produce object/array/string/number/boolean/
 * null, so treating anything that isn't caught by the array or
 * plain-object branch as an already-safe leaf value is exhaustive, not
 * an oversight.
 */
function validateJsonValueRecursively(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      validateJsonValueRecursively(item)
    }
    return
  }
  if (isPlainObject(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (UNSAFE_CHANGED_FIELD_KEYS.has(key)) {
        throw new AuditServiceError(`changed_fields contains an unsafe key: ${key}`)
      }
      validateJsonValueRecursively(nestedValue)
    }
  }
}

/**
 * Strict runtime validation for a stored changed_fields JSON blob —
 * replaces a naive `JSON.parse(...) as Record<string, FieldChange>`
 * cast, which trusted the shape of a raw database column without ever
 * checking it. Every failure mode below throws AuditServiceError,
 * which propagates out of listEntries uncaught — this is deliberate:
 * a single malformed row must fail the whole request rather than
 * silently return alongside otherwise-valid entries (never a partially
 * parsed entry) or get skipped invisibly.
 *
 * Each field-change object's own enumerable keys must be exactly old
 * and new — order doesn't matter, but a third key (even one that is
 * not itself security-sensitive) is rejected outright, never silently
 * dropped. `result[key] = { old: value.old, new: value.new }` further
 * down only ever copies exactly those two properties regardless, but
 * reaching that line at all now requires the object to have had
 * nothing else to drop in the first place — this function no longer
 * repairs a malformed row by discarding what it didn't expect.
 *
 * Confirmed directly (before relying on this) that JSON.parse creates
 * a key literally named '__proto__' as a normal own, enumerable
 * property — never a prototype mutation — so a plain Object.entries
 * iteration and an explicit key-name check together are sufficient to
 * catch it, prototype, and constructor as ordinary string keys.
 */
function validateChangedFields(raw: string): Record<string, FieldChange> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AuditServiceError('changed_fields column is not valid JSON')
  }

  if (!isPlainObject(parsed)) {
    throw new AuditServiceError('changed_fields must decode to a plain object')
  }

  const result: Record<string, FieldChange> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (UNSAFE_CHANGED_FIELD_KEYS.has(key)) {
      throw new AuditServiceError(`changed_fields contains an unsafe key: ${key}`)
    }
    if (!isPlainObject(value)) {
      throw new AuditServiceError(`changed_fields.${key} must be a plain object`)
    }
    const valueKeys = Object.keys(value)
    const hasExactlyOldAndNew =
      valueKeys.length === 2 && valueKeys.includes('old') && valueKeys.includes('new')
    if (!hasExactlyOldAndNew) {
      throw new AuditServiceError(
        `changed_fields.${key} must have exactly the properties old and new, in either order, with no other keys`
      )
    }
    // The field-change shape itself (an object with exactly old and
    // new, nothing else) is checked above; validateJsonValueRecursively
    // is now run on the *whole* field-change object, not just
    // value.old/value.new separately — this is what catches an unsafe
    // key sitting as a direct sibling of old/new inside the same
    // object (e.g. {"old":1,"new":2,"__proto__":{...}}), which
    // checking only the old and new values in isolation would silently
    // miss, in addition to everything nested inside old and new at any
    // depth. In practice this call is now redundant for a same-level
    // sibling key specifically (the exact-two-keys check above already
    // rejects any such object before this line), but it remains the
    // one thing that still validates *inside* old and new themselves.
    validateJsonValueRecursively(value)
    result[key] = { old: value.old, new: value.new }
  }
  return result
}

export interface RecordAuditEntryInput {
  entityType: string
  entityId: string
  entityLabel: string
  action: AuditAction
  actor: AuditActor
  companyId: string | null
  /** null for a create (nothing existed before). */
  before: Record<string, unknown> | null
  /** null only for a hypothetical delete action — no delete action exists in this slice. */
  after: Record<string, unknown> | null
}

export interface AuditLogEntry {
  id: string
  entityType: string
  entityId: string
  entityLabel: string
  action: AuditAction
  changedFields: Record<string, FieldChange> | null
  actorType: AuditActorType
  userId: string | null
  /**
   * A human-readable label resolved server-side, never trusted from
   * the renderer: 'System' for a system actor; the user's current
   * displayName, read fresh via a join against users on every list
   * call (never cached at write time, so a later display-name change
   * is reflected immediately); 'Unknown user' only in the defensive,
   * expected-unreachable case of a user actor whose referenced row is
   * missing (the users FK uses ON DELETE RESTRICT specifically to keep
   * this case unreachable in practice).
   */
  actorLabel: string
  companyId: string | null
  occurredAt: Date
}

export interface AuditCursor {
  occurredAt: number
  id: string
}

export interface ListAuditEntriesFilter {
  entityType?: string
  fromOccurredAt?: number
  toOccurredAt?: number
  cursor?: AuditCursor
  limit?: number
}

export interface ListAuditEntriesResult {
  entries: AuditLogEntry[]
  nextCursor: AuditCursor | null
}

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

const REDACTED_PLACEHOLDER = '[redacted]'

/**
 * Matched against a normalized (lower-cased, with `_`/`-`/space
 * stripped) key name as a substring — so 'passwordHash', 'password_hash',
 * 'PASSWORD-HASH', and 'recoveryKeyHash' are all caught by 'password'
 * and/or 'hash' without needing every literal spelling enumerated.
 */
const REDACTED_KEY_PATTERNS = [
  'password',
  'passphrase',
  'hash',
  'secret',
  'token',
  'recovery',
  'credential',
  'apikey',
  'privatekey',
  'authorization',
  'cookie',
  'session',
  'otp',
  'salt'
]

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\s-]/g, '')
}

function isRedactedKey(key: string): boolean {
  const normalized = normalizeKey(key)
  return REDACTED_KEY_PATTERNS.some((pattern) => normalized.includes(pattern))
}

/**
 * Recursively walks `value`. If `keyHint` (the property name this value
 * was reached through) matches a redacted pattern, the entire value —
 * however deeply nested, whatever shape — is replaced with a fixed
 * placeholder without recursing further into it. Otherwise arrays and
 * plain objects are walked field by field, checking each nested key
 * independently; anything else (primitives, Dates) is returned as-is.
 */
function redactValue(value: unknown, keyHint: string | undefined): unknown {
  if (keyHint !== undefined && isRedactedKey(keyHint)) {
    return REDACTED_PLACEHOLDER
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, undefined))
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = redactValue(v, k)
    }
    return result
  }
  return value
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * create: every field in `after` recorded as {old: null, new: value}
 * (Correction 5) — there is always something to record for a create, so
 * this path never returns an empty object given a non-empty `after`.
 *
 * update/deactivate/reactivate: only fields that actually differ between
 * `before` and `after` are included — an unchanged field is omitted
 * entirely, not recorded as old === new. Redaction is applied to both
 * the old and new value of every included field.
 */
function computeChangedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {}

  if (before === null) {
    for (const [key, value] of Object.entries(after ?? {})) {
      changes[key] = { old: null, new: redactValue(value, key) }
    }
    return changes
  }

  if (after === null) {
    for (const [key, value] of Object.entries(before)) {
      changes[key] = { old: redactValue(value, key), new: null }
    }
    return changes
  }

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of allKeys) {
    const oldValue = before[key]
    const newValue = after[key]
    if (!valuesEqual(oldValue, newValue)) {
      changes[key] = { old: redactValue(oldValue, key), new: redactValue(newValue, key) }
    }
  }
  return changes
}

/**
 * Writes exactly one audit row for one durable entity mutation, inside
 * the caller's already-open transaction (`tx`, never a plain `AppDb`) —
 * this is deliberate and load-bearing: an audit-write failure (a bad
 * serialization, a constraint violation, anything) must roll back the
 * business mutation it accompanies, and the only way to guarantee that
 * is for both writes to live inside the exact same SQLite transaction.
 * This function never catches its own errors — an exception here
 * propagates straight out through the caller's db.transaction(...)
 * callback, which rolls back automatically. Do not wrap a call to this
 * function in a try/catch that swallows the error; doing so would
 * silently break the "every mutation produces exactly one matching
 * audit row, atomically" guarantee this whole module exists to provide.
 *
 * For 'update'/'deactivate'/'reactivate', if the computed diff between
 * `before` and `after` is empty (a true no-op), no row is written at all
 * — checked before any insert is attempted, not filtered out afterward.
 * 'create' always writes, since a newly-created entity always has at
 * least one field to record.
 */
export function record(
  tx: AppTransaction,
  input: RecordAuditEntryInput,
  now: Date = new Date()
): void {
  const changedFields = computeChangedFields(input.before, input.after)

  if (input.action !== 'create' && Object.keys(changedFields).length === 0) {
    return
  }

  const id = `audit_${randomUUID()}`
  const changedFieldsJson =
    Object.keys(changedFields).length > 0 ? JSON.stringify(changedFields) : null

  tx.insert(auditLogEntries)
    .values({
      id,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      action: input.action,
      changedFields: changedFieldsJson,
      actorType: input.actor.type,
      userId: input.actor.type === 'user' ? input.actor.userId : null,
      companyId: input.companyId,
      occurredAt: now
    })
    .run()
}

interface JoinedAuditRow {
  id: string
  entityType: string
  entityId: string
  entityLabel: string
  action: string
  changedFields: string | null
  actorType: string
  userId: string | null
  companyId: string | null
  occurredAt: Date
  actorDisplayName: string | null
}

function toAuditLogEntry(row: JoinedAuditRow): AuditLogEntry {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    action: row.action as AuditAction,
    changedFields: row.changedFields ? validateChangedFields(row.changedFields) : null,
    actorType: row.actorType as AuditActorType,
    userId: row.userId,
    actorLabel: resolveActorLabel(row.actorType, row.actorDisplayName),
    companyId: row.companyId,
    occurredAt: row.occurredAt
  }
}

/**
 * system -> 'System'. user with a resolved displayName -> that name,
 * read fresh via the join in listEntries below, never cached at write
 * time. user with no resolved row -> 'Unknown user' — defensively
 * handled but not expected to occur in practice, since
 * audit_log_entries.user_id uses ON DELETE RESTRICT specifically to
 * keep this case unreachable.
 */
function resolveActorLabel(actorType: string, actorDisplayName: string | null): string {
  if (actorType === 'system') {
    return 'System'
  }
  return actorDisplayName ?? 'Unknown user'
}

/**
 * Bounded cursor pagination (Correction 6) — never returns the complete
 * table. `limit` defaults to DEFAULT_LIST_LIMIT and is hard-clamped to
 * MAX_LIST_LIMIT regardless of what's requested; a caller cannot request
 * an unbounded page by supplying a huge number. Ordering is
 * occurred_at DESC, id DESC — stable and gap-free across pages even
 * though occurred_at alone is not guaranteed unique (two entries in the
 * same transaction can share a millisecond timestamp). Fetches one row
 * beyond `limit` to determine whether a next page exists, without
 * needing a separate COUNT query.
 *
 * Left-joins users to resolve each row's actorLabel in the same query
 * — never a per-row lookup, never trusting anything the caller
 * supplies about who the actor is. A system-actor row's user_id is
 * always null (enforced by the actor-consistency CHECK constraint), so
 * its join side is naturally absent regardless.
 */
export function listEntries(
  db: AppDb,
  filter: ListAuditEntriesFilter = {}
): ListAuditEntriesResult {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)

  const conditions = []
  if (filter.entityType !== undefined) {
    conditions.push(eq(auditLogEntries.entityType, filter.entityType))
  }
  if (filter.fromOccurredAt !== undefined) {
    conditions.push(gte(auditLogEntries.occurredAt, new Date(filter.fromOccurredAt)))
  }
  if (filter.toOccurredAt !== undefined) {
    conditions.push(lte(auditLogEntries.occurredAt, new Date(filter.toOccurredAt)))
  }
  if (filter.cursor) {
    const cursorDate = new Date(filter.cursor.occurredAt)
    conditions.push(
      or(
        lt(auditLogEntries.occurredAt, cursorDate),
        and(eq(auditLogEntries.occurredAt, cursorDate), lt(auditLogEntries.id, filter.cursor.id))
      )
    )
  }

  const rows = db
    .select({
      id: auditLogEntries.id,
      entityType: auditLogEntries.entityType,
      entityId: auditLogEntries.entityId,
      entityLabel: auditLogEntries.entityLabel,
      action: auditLogEntries.action,
      changedFields: auditLogEntries.changedFields,
      actorType: auditLogEntries.actorType,
      userId: auditLogEntries.userId,
      companyId: auditLogEntries.companyId,
      occurredAt: auditLogEntries.occurredAt,
      actorDisplayName: users.displayName
    })
    .from(auditLogEntries)
    .leftJoin(users, eq(auditLogEntries.userId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogEntries.occurredAt), desc(auditLogEntries.id))
    .limit(limit + 1)
    .all()

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const lastRow = pageRows[pageRows.length - 1]

  return {
    entries: pageRows.map(toAuditLogEntry),
    nextCursor:
      hasMore && lastRow ? { occurredAt: lastRow.occurredAt.getTime(), id: lastRow.id } : null
  }
}
