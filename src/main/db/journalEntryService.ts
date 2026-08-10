import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import {
  FUNCTIONAL_CURRENCY_ID,
  journalEntries,
  journalEntryLines,
  PRIMARY_COMPANY_ID
} from './schema'
import {
  requireTrimmedJournalEntryDescription,
  requireValidEntryDate,
  validateJournalEntryLines,
  type JournalEntryLineInput
} from './validation/journalEntryValidation'
import { requireActiveAccountForPosting } from './chartOfAccountsService'
import { allocateNext } from './numberingService'
import { record, type AuditActor } from '../audit/auditService'
import type { AppDb, AppTransaction } from './dbTypes'

export class JournalEntryServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JournalEntryServiceError'
  }
}

export interface JournalEntryLine {
  id: string
  journalEntryId: string
  accountId: string
  debitMinor: number
  creditMinor: number
  description: string | null
  lineOrder: number
}

export interface JournalEntry {
  id: string
  companyId: string
  entryNumber: string
  entryDate: Date
  description: string
  externalReference: string | null
  currencyId: string
  createdByUserId: string
  reversedEntryId: string | null
  reversalReason: string | null
  createdAt: Date
  lines: JournalEntryLine[]
}

export interface CreateJournalEntryInput {
  entryDate: Date
  description: string
  externalReference?: string | null
  lines: readonly JournalEntryLineInput[]
}

function toJournalEntryLine(row: typeof journalEntryLines.$inferSelect): JournalEntryLine {
  return {
    id: row.id,
    journalEntryId: row.journalEntryId,
    accountId: row.accountId,
    debitMinor: row.debitMinor,
    creditMinor: row.creditMinor,
    description: row.description,
    lineOrder: row.lineOrder
  }
}

function loadLinesForEntry(db: AppDb, journalEntryId: string): JournalEntryLine[] {
  const rows = db
    .select()
    .from(journalEntryLines)
    .where(eq(journalEntryLines.journalEntryId, journalEntryId))
    .orderBy(asc(journalEntryLines.lineOrder))
    .all()
  return rows.map(toJournalEntryLine)
}

function toJournalEntry(db: AppDb, row: typeof journalEntries.$inferSelect): JournalEntry {
  return {
    id: row.id,
    companyId: row.companyId,
    entryNumber: row.entryNumber,
    entryDate: row.entryDate,
    description: row.description,
    externalReference: row.externalReference,
    currencyId: row.currencyId,
    createdByUserId: row.createdByUserId,
    reversedEntryId: row.reversedEntryId,
    reversalReason: row.reversalReason,
    createdAt: row.createdAt,
    lines: loadLinesForEntry(db, row.id)
  }
}

export function getJournalEntryById(db: AppDb, id: string): JournalEntry | undefined {
  const row = db.select().from(journalEntries).where(eq(journalEntries.id, id)).get()
  return row ? toJournalEntry(db, row) : undefined
}

export function listJournalEntries(db: AppDb): JournalEntry[] {
  const rows = db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.companyId, PRIMARY_COMPANY_ID))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.createdAt), asc(journalEntries.id))
    .all()
  return rows.map((row) => toJournalEntry(db, row))
}

/**
 * Created posted immediately — no draft/status concept exists anywhere
 * in this file. Validates every line (validateJournalEntryLines throws
 * on fewer than two lines, any line with both/neither side positive,
 * or an overall debit/credit imbalance), confirms every referenced
 * account is currently active (new manual postings only — reversals
 * are exempted, see reverseJournalEntry's own comment), allocates the
 * entry number inside the same transaction as the entry+lines insert
 * (mirroring createOpeningLot's own allocate-inside-transaction
 * precedent), and writes one audit row for the entry itself. currency
 * is always FUNCTIONAL_CURRENCY_ID, assigned server-side — multi-
 * currency posting is out of scope for this slice.
 */
export function createJournalEntry(
  db: AppDb,
  input: CreateJournalEntryInput,
  actor: AuditActor,
  now: Date = new Date()
): JournalEntry {
  if (actor.type !== 'user') {
    throw new JournalEntryServiceError('A journal entry must be created by a real user')
  }

  const entryDate = requireValidEntryDate(input.entryDate)
  const description = requireTrimmedJournalEntryDescription(input.description)
  const externalReference =
    input.externalReference && input.externalReference.trim().length > 0
      ? input.externalReference.trim()
      : null
  const validatedLines = validateJournalEntryLines(input.lines)

  for (const line of validatedLines) {
    requireActiveAccountForPosting(db, line.accountId)
  }

  const entryId = `journal_entry_${randomUUID()}`

  db.transaction((tx) => {
    const entryNumber = allocateNext(tx as AppTransaction, 'journal_entry', now)

    tx.insert(journalEntries)
      .values({
        id: entryId,
        companyId: PRIMARY_COMPANY_ID,
        entryNumber,
        entryDate,
        description,
        externalReference,
        currencyId: FUNCTIONAL_CURRENCY_ID,
        createdByUserId: actor.userId,
        reversedEntryId: null,
        reversalReason: null,
        createdAt: now
      })
      .run()

    validatedLines.forEach((line, index) => {
      tx.insert(journalEntryLines)
        .values({
          id: `journal_entry_line_${randomUUID()}`,
          companyId: PRIMARY_COMPANY_ID,
          journalEntryId: entryId,
          accountId: line.accountId,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          description: line.description,
          lineOrder: index
        })
        .run()
    })

    record(
      tx,
      {
        entityType: 'journal_entry',
        entityId: entryId,
        entityLabel: entryNumber,
        action: 'create',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: null,
        after: {
          entryNumber,
          entryDate: entryDate.getTime(),
          description,
          lineCount: validatedLines.length
        }
      },
      now
    )
  })

  const created = getJournalEntryById(db, entryId)
  if (!created) {
    throw new JournalEntryServiceError('Journal entry was not persisted after creation')
  }
  return created
}

/**
 * Creates a brand-new entry with every line's debit/credit exactly
 * swapped from the original (never edits the original in place — the
 * original remains untouched forever), linked via reversedEntryId. A
 * non-blank reason is always required. An entry can be reversed once
 * only, enforced both by an explicit pre-check here and by the
 * database's own unique constraint on reversed_entry_id as a second
 * line of defense — mirroring stock_movements' own reversal-once-only
 * precedent exactly. A reversal entry can never itself be reversed
 * (checked explicitly: if the target is already a reversal of
 * something else, this throws before ever touching the database).
 *
 * Unlike createJournalEntry, this function does NOT require every
 * referenced account to currently be active — undoing a past action
 * must work even after a later, unrelated account deactivation,
 * mirroring reverseMovement's own exact precedent for inventory lots.
 */
export function reverseJournalEntry(
  db: AppDb,
  originalEntryId: string,
  reason: string,
  actor: AuditActor,
  now: Date = new Date()
): JournalEntry {
  if (actor.type !== 'user') {
    throw new JournalEntryServiceError('A journal entry reversal must be created by a real user')
  }

  const trimmedReason = reason.trim()
  if (trimmedReason.length === 0) {
    throw new JournalEntryServiceError('reversalReason is required and must not be blank')
  }

  const original = getJournalEntryById(db, originalEntryId)
  if (!original) {
    throw new JournalEntryServiceError(`No journal entry exists with id "${originalEntryId}"`)
  }

  if (original.reversedEntryId !== null) {
    throw new JournalEntryServiceError(
      `Journal entry "${originalEntryId}" is itself a reversal and cannot be reversed again`
    )
  }

  const existingReversal = db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.reversedEntryId, originalEntryId))
    .get()
  if (existingReversal) {
    throw new JournalEntryServiceError(
      `Journal entry "${originalEntryId}" has already been reversed and cannot be reversed again`
    )
  }

  const reversalId = `journal_entry_${randomUUID()}`

  db.transaction((tx) => {
    const entryNumber = allocateNext(tx as AppTransaction, 'journal_entry', now)

    tx.insert(journalEntries)
      .values({
        id: reversalId,
        companyId: PRIMARY_COMPANY_ID,
        entryNumber,
        entryDate: now,
        description: `Reversal of ${original.entryNumber}: ${original.description}`,
        externalReference: original.externalReference,
        currencyId: FUNCTIONAL_CURRENCY_ID,
        createdByUserId: actor.userId,
        reversedEntryId: originalEntryId,
        reversalReason: trimmedReason,
        createdAt: now
      })
      .run()

    // Preserves account, line order, and line description exactly;
    // only debit and credit are swapped.
    for (const line of original.lines) {
      tx.insert(journalEntryLines)
        .values({
          id: `journal_entry_line_${randomUUID()}`,
          companyId: PRIMARY_COMPANY_ID,
          journalEntryId: reversalId,
          accountId: line.accountId,
          debitMinor: line.creditMinor,
          creditMinor: line.debitMinor,
          description: line.description,
          lineOrder: line.lineOrder
        })
        .run()
    }

    record(
      tx,
      {
        entityType: 'journal_entry',
        entityId: reversalId,
        entityLabel: entryNumber,
        action: 'create',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: null,
        after: {
          entryNumber,
          reversedEntryId: originalEntryId,
          reversalReason: trimmedReason
        }
      },
      now
    )
  })

  const created = getJournalEntryById(db, reversalId)
  if (!created) {
    throw new JournalEntryServiceError('Reversal journal entry was not persisted after creation')
  }
  return created
}
