import { ACCOUNT_CATEGORIES } from '../schema'

export class AccountValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountValidationError'
  }
}

export type AccountCategory = (typeof ACCOUNT_CATEGORIES)[number]

const ACCOUNT_CODE_PATTERN = /^[0-9]{4,10}$/

/**
 * Caller-supplied, immutable, 4-10 ASCII digits — approved decision
 * (see accounts' own schema comment for the full reasoning). Rejects
 * anything with a decimal point, a sign, letters, or leading/trailing
 * whitespace baked in; the caller is expected to trim before calling,
 * but this still rejects a value that trims to something out of range
 * rather than silently reformatting it.
 */
export function requireValidAccountCode(rawCode: string): string {
  const trimmed = rawCode.trim()
  if (!ACCOUNT_CODE_PATTERN.test(trimmed)) {
    throw new AccountValidationError(`code must be 4-10 ASCII digits only, received "${rawCode}"`)
  }
  return trimmed
}

export function requireTrimmedAccountName(rawName: string): string {
  const trimmed = rawName.trim()
  if (trimmed.length === 0) {
    throw new AccountValidationError('name must not be blank')
  }
  return trimmed
}

export function requireValidAccountCategory(rawCategory: string): AccountCategory {
  if (!(ACCOUNT_CATEGORIES as readonly string[]).includes(rawCategory)) {
    throw new AccountValidationError(
      `category must be one of ${ACCOUNT_CATEGORIES.join(', ')}; received "${rawCategory}"`
    )
  }
  return rawCategory as AccountCategory
}

/**
 * subtype is optional and freer-form than category; blank (post-trim)
 * normalizes to null, matching this codebase's established convention
 * for optional text fields (e.g. inventoryLotService.ts's own
 * normalizeSupplierLotNumber).
 */
export function normalizeAccountSubtype(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * debit for asset/cost_of_goods_sold/expense, credit for
 * liability/equity/revenue — the standard double-entry normal-balance
 * rule, derived purely from category (never stored as its own column,
 * since it is entirely a function of category and storing it separately
 * would create a second source of truth that could drift).
 */
export type NormalBalance = 'debit' | 'credit'

const DEBIT_NORMAL_CATEGORIES: readonly AccountCategory[] = [
  'asset',
  'cost_of_goods_sold',
  'expense'
]

export function deriveNormalBalance(category: AccountCategory): NormalBalance {
  return DEBIT_NORMAL_CATEGORIES.includes(category) ? 'debit' : 'credit'
}
