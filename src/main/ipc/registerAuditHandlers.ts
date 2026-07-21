import { ipcMain } from 'electron'
import {
  AUDIT_LIST_CHANNEL,
  type AuditCursor,
  type AuditErrorCode,
  type ListAuditEntriesInput,
  type ListAuditEntriesResult,
  type SafeAuditLogEntry
} from '../../shared/ipc/audit'
import type { NavigationPolicyContext } from '../security/navigationPolicy'
import { isApprovedIpcSender, type ApprovableIpcEvent } from '../security/senderValidation'
import { requireAuthorizedCaller } from '../auth/requireAuthorizedCaller'
import { listEntries, type AuditLogEntry } from '../audit/auditService'
import type { LoginService } from '../users/loginService'
import type { AppDb } from '../db/dbTypes'

class AuditIpcInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuditIpcInputError'
  }
}

function requireApprovedSender(event: ApprovableIpcEvent, context: NavigationPolicyContext): void {
  if (!isApprovedIpcSender(event, context)) {
    throw new Error('LedgerPage: rejected audit request from an unapproved sender')
  }
}

function requireStringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AuditIpcInputError(`${fieldName} must be a non-empty string`)
  }
  return value
}

function requireOptionalStringField(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  return requireStringField(value, fieldName)
}

/**
 * Rejects NaN, Infinity/-Infinity, and non-numbers explicitly — a bare
 * `typeof value === 'number'` check alone would let all three through,
 * since NaN and Infinity are both technically the `number` type in
 * JavaScript.
 */
function requireOptionalFiniteNumberField(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AuditIpcInputError(`${fieldName} must be a finite number`)
  }
  return value
}

function requireOptionalLimitField(value: unknown, fieldName: string): number | undefined {
  const parsed = requireOptionalFiniteNumberField(value, fieldName)
  if (parsed === undefined) {
    return undefined
  }
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AuditIpcInputError(`${fieldName} must be a positive integer`)
  }
  return parsed
}

function parseCursor(value: unknown): AuditCursor | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'object' || value === null) {
    throw new AuditIpcInputError('cursor must be an object')
  }
  const candidate = value as Record<string, unknown>
  const occurredAt = requireOptionalFiniteNumberField(candidate.occurredAt, 'cursor.occurredAt')
  if (occurredAt === undefined) {
    throw new AuditIpcInputError('cursor.occurredAt is required')
  }
  return { occurredAt, id: requireStringField(candidate.id, 'cursor.id') }
}

/**
 * Validates every field's shape and, where two fields interact
 * (fromOccurredAt vs toOccurredAt), their relationship — a malformed
 * cursor, a NaN/Infinity limit, a negative or non-integer limit, or an
 * inverted date range are all rejected here as invalid_input, before
 * this input ever reaches auditService.
 */
function parseListAuditEntriesInput(rawInput: unknown): ListAuditEntriesInput {
  if (rawInput === undefined || rawInput === null) {
    return {}
  }
  if (typeof rawInput !== 'object') {
    throw new AuditIpcInputError('input must be an object')
  }
  const candidate = rawInput as Record<string, unknown>

  const entityType = requireOptionalStringField(candidate.entityType, 'entityType')
  const fromOccurredAt = requireOptionalFiniteNumberField(
    candidate.fromOccurredAt,
    'fromOccurredAt'
  )
  const toOccurredAt = requireOptionalFiniteNumberField(candidate.toOccurredAt, 'toOccurredAt')
  const limit = requireOptionalLimitField(candidate.limit, 'limit')
  const cursor = parseCursor(candidate.cursor)

  if (fromOccurredAt !== undefined && toOccurredAt !== undefined && fromOccurredAt > toOccurredAt) {
    throw new AuditIpcInputError('fromOccurredAt must not be after toOccurredAt')
  }

  return { entityType, fromOccurredAt, toOccurredAt, limit, cursor }
}

function toSafeAuditLogEntry(entry: AuditLogEntry): SafeAuditLogEntry {
  return {
    id: entry.id,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityLabel: entry.entityLabel,
    action: entry.action,
    changedFields: entry.changedFields,
    actorType: entry.actorType,
    userId: entry.userId,
    actorLabel: entry.actorLabel,
    companyId: entry.companyId,
    occurredAt: entry.occurredAt.getTime()
  }
}

export interface RegisterAuditHandlersOptions {
  context: NavigationPolicyContext
  db: AppDb
  loginService: LoginService
}

/**
 * Registers the one Slice 10 audit channel. audit:list is gated by
 * requireAuthorizedCaller(db, loginService, 'audit.read') — resolved
 * fresh from SQLite on every single call, never trusting anything the
 * renderer supplies. In particular, the renderer's own
 * session.canViewAuditLog flag (used only to decide whether to *show*
 * the Audit Log nav link) plays no role here whatsoever — this handler
 * doesn't receive it, doesn't read it, and would behave identically if
 * it didn't exist. A caller who somehow reached this channel without
 * ever seeing that link (a locked session, a deactivated user, an
 * Operations-role user, or no session at all) gets exactly the same
 * fresh, independent check as one who clicked the link normally.
 *
 * No mutation channel is registered here, or anywhere else in this
 * codebase — there is no audit:create, audit:update, or audit:delete
 * channel, matching auditService's own append-only surface exactly.
 */
export function registerAuditHandlers(options: RegisterAuditHandlersOptions): void {
  const { context, db, loginService } = options

  ipcMain.handle(AUDIT_LIST_CHANNEL, (event, rawInput: unknown): ListAuditEntriesResult => {
    requireApprovedSender(event, context)

    let input: ListAuditEntriesInput
    try {
      input = parseListAuditEntriesInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' satisfies AuditErrorCode }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'audit.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    let result: ReturnType<typeof listEntries>
    try {
      result = listEntries(db, {
        entityType: input.entityType,
        fromOccurredAt: input.fromOccurredAt,
        toOccurredAt: input.toOccurredAt,
        limit: input.limit,
        cursor: input.cursor
      })
    } catch {
      return { success: false, errorCode: 'unexpected_error' }
    }

    return {
      success: true,
      entries: result.entries.map(toSafeAuditLogEntry),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {})
    }
  })
}
