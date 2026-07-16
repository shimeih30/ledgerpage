import { and, eq } from 'drizzle-orm'
import { numberingRules, PRIMARY_COMPANY_ID } from './schema'
import { isApprovedDocumentTypeKey } from './numberingDefaults'
import type { AppTransaction } from './dbTypes'

export class NumberingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NumberingError'
  }
}

/**
 * Allocates the next document number for `documentTypeKey`, formatted
 * per the approved rules:
 *
 * - yearly:  PREFIX-YYYY-000001, restarting at 1 whenever the UTC year
 *   (per `now`) differs from the rule's last-used year;
 * - never:   PREFIX-000001, continuing unbroken across year boundaries.
 *
 * `tx` must be an active, caller-controlled transaction — the type
 * itself (AppTransaction, not the broader AppDb) makes it a compile-time
 * error to call this outside one. This function never opens or commits
 * its own transaction: the SELECT and UPDATE below both run against the
 * exact `tx` the caller passed in, so a throw anywhere in the caller's
 * transaction (before or after this call) rolls the allocation back too,
 * and a successful commit persists it — there is no separate commit step
 * that could let the two diverge.
 *
 * Concurrency: LedgerPage holds at most one process against the database
 * at a time (the single-instance lock from Slice 3) and better-sqlite3 is
 * synchronous with one connection, so within that one process a SELECT
 * immediately followed by an UPDATE inside one transaction cannot be
 * interleaved by any other writer — there is no other writer. This is
 * proven by test (sequential allocations never repeat; a rollback
 * reverts the increment), not merely assumed.
 *
 * Throws NumberingError for an unsupported document type key or a
 * missing numbering rule — never silently allocates in either case.
 */
export function allocateNext(
  tx: AppTransaction,
  documentTypeKey: string,
  now: Date = new Date()
): string {
  if (!isApprovedDocumentTypeKey(documentTypeKey)) {
    throw new NumberingError(`Unsupported document type key: "${documentTypeKey}"`)
  }

  const rule = tx
    .select()
    .from(numberingRules)
    .where(
      and(
        eq(numberingRules.companyId, PRIMARY_COMPANY_ID),
        eq(numberingRules.documentTypeKey, documentTypeKey)
      )
    )
    .get()

  if (!rule) {
    throw new NumberingError(`No numbering rule exists for document type "${documentTypeKey}"`)
  }

  const utcYear = now.getUTCFullYear()
  let nextValue: number
  let nextYear: number | null = rule.currentSequenceYear

  if (rule.resetBehavior === 'yearly') {
    if (rule.currentSequenceYear !== utcYear) {
      nextValue = 1
      nextYear = utcYear
    } else {
      nextValue = rule.currentSequenceValue + 1
    }
  } else {
    nextValue = rule.currentSequenceValue + 1
  }

  tx.update(numberingRules)
    .set({
      currentSequenceValue: nextValue,
      currentSequenceYear: nextYear,
      updatedAt: now
    })
    .where(eq(numberingRules.id, rule.id))
    .run()

  const paddedSequence = String(nextValue).padStart(rule.paddingLength, '0')

  return rule.resetBehavior === 'yearly'
    ? `${rule.prefix}-${utcYear}-${paddedSequence}`
    : `${rule.prefix}-${paddedSequence}`
}
