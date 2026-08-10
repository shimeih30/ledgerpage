export class JournalEntryValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JournalEntryValidationError'
  }
}

export interface JournalEntryLineInput {
  accountId: string
  debitMinor: number
  creditMinor: number
  description?: string | null
}

export interface ValidatedJournalEntryLine {
  accountId: string
  debitMinor: number
  creditMinor: number
  description: string | null
}

/**
 * A safe, non-negative, integer minor-currency-units value — the same
 * strictness posture as every other money field in this codebase.
 * Never a float; never derived via Number(x) * 100 (see
 * journalDecimal.ts's own renderer-side parsing counterpart for the
 * exact string-based reasoning this mirrors).
 */
function requireNonNegativeIntegerMinor(value: number, fieldName: string): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new JournalEntryValidationError(
      `${fieldName} must be a finite number, received ${String(value)}`
    )
  }
  if (!Number.isInteger(value)) {
    throw new JournalEntryValidationError(
      `${fieldName} must be an integer, received ${String(value)}`
    )
  }
  if (!Number.isSafeInteger(value)) {
    throw new JournalEntryValidationError(`${fieldName} must be a safe integer`)
  }
  if (value < 0) {
    throw new JournalEntryValidationError(
      `${fieldName} must not be negative, received ${String(value)}`
    )
  }
  return value
}

export function requireTrimmedJournalEntryDescription(rawDescription: string): string {
  const trimmed = rawDescription.trim()
  if (trimmed.length === 0) {
    throw new JournalEntryValidationError('description must not be blank')
  }
  return trimmed
}

export function requireValidEntryDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new JournalEntryValidationError('entryDate must be a valid date')
  }
  return value
}

function normalizeLineDescription(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Validates a single line in isolation: exactly one side (debit XOR
 * credit) must be positive, the other exactly zero — never both
 * positive, never both zero. This mirrors journal_entry_lines'
 * own database CHECK constraint exactly, so a caller that somehow
 * bypassed this validation would still be caught by the database as a
 * second line of defense.
 */
function validateSingleLine(
  line: JournalEntryLineInput,
  lineIndex: number
): ValidatedJournalEntryLine {
  if (typeof line.accountId !== 'string' || line.accountId.trim().length === 0) {
    throw new JournalEntryValidationError(`line ${lineIndex}: accountId must be a non-empty string`)
  }
  const debitMinor = requireNonNegativeIntegerMinor(
    line.debitMinor,
    `line ${lineIndex}: debitMinor`
  )
  const creditMinor = requireNonNegativeIntegerMinor(
    line.creditMinor,
    `line ${lineIndex}: creditMinor`
  )

  const debitPositive = debitMinor > 0
  const creditPositive = creditMinor > 0
  if (debitPositive === creditPositive) {
    throw new JournalEntryValidationError(
      `line ${lineIndex}: exactly one of debitMinor or creditMinor must be positive (received debit=${debitMinor}, credit=${creditMinor})`
    )
  }

  return {
    accountId: line.accountId,
    debitMinor,
    creditMinor,
    description: normalizeLineDescription(line.description)
  }
}

/**
 * Validates the full set of lines for one journal entry: at least two
 * lines, each individually valid, and total debits exactly equal total
 * credits (both totals also strictly greater than zero — an entry
 * where every line is technically "one side positive" but the grand
 * totals still sum to zero is not constructible given the per-line
 * rule, but this is asserted explicitly rather than left implicit).
 *
 * The same account MAY appear on more than one line of the same entry
 * — approved, intentional design, not an oversight. Standard
 * double-entry practice permits this (e.g. two separate debits to the
 * same expense account for two different underlying reasons within one
 * entry, each with its own line description) — this validator
 * deliberately does not enforce per-entry account uniqueness.
 */
export function validateJournalEntryLines(
  rawLines: readonly JournalEntryLineInput[]
): ValidatedJournalEntryLine[] {
  if (rawLines.length < 2) {
    throw new JournalEntryValidationError(
      `a journal entry must have at least two lines; received ${rawLines.length}`
    )
  }

  const validatedLines = rawLines.map((line, index) => validateSingleLine(line, index))

  const totalDebitMinor = validatedLines.reduce((sum, line) => sum + line.debitMinor, 0)
  const totalCreditMinor = validatedLines.reduce((sum, line) => sum + line.creditMinor, 0)

  if (totalDebitMinor !== totalCreditMinor) {
    throw new JournalEntryValidationError(
      `total debits (${totalDebitMinor}) must equal total credits (${totalCreditMinor})`
    )
  }
  if (totalDebitMinor <= 0) {
    throw new JournalEntryValidationError('total debits and credits must both be greater than zero')
  }

  return validatedLines
}
