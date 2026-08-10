import { eq } from 'drizzle-orm'
import { accounts, journalEntryLines, PRIMARY_COMPANY_ID } from './schema'
import {
  deriveNormalBalance,
  type AccountCategory,
  type NormalBalance
} from './validation/accountValidation'
import type { AppDb } from './dbTypes'

export interface TrialBalanceAccountRow {
  id: string
  code: string
  name: string
  category: AccountCategory
  subtype: string | null
  normalBalance: NormalBalance
  isActive: boolean
  totalDebitMinor: number
  totalCreditMinor: number
  closingDebitMinor: number
  closingCreditMinor: number
}

export interface TrialBalance {
  accounts: TrialBalanceAccountRow[]
  grandTotalDebitMinor: number
  grandTotalCreditMinor: number
  isBalanced: boolean
}

/**
 * Reconstructed directly from journal_entry_lines on every call — no
 * cached balance column exists anywhere for this purpose, and this
 * function never reads one. Every account is included, even one with
 * zero activity or one that is inactive, per the approved scope ("no
 * date range or accounting period in Slice 16" — this is an all-time
 * total as of right now).
 *
 * A "closing" debit/credit pair is derived by netting totalDebitMinor
 * against totalCreditMinor and re-expressing the net on whichever side
 * is larger (the conventional trial-balance presentation: an account
 * with more debit activity than credit activity shows only in the
 * debit column, and vice versa) — this is presentation only, computed
 * fresh from the same two already-reconstructed totals, never a third
 * independent source.
 */
export function getTrialBalance(db: AppDb): TrialBalance {
  const accountRows = db
    .select()
    .from(accounts)
    .where(eq(accounts.companyId, PRIMARY_COMPANY_ID))
    .orderBy(accounts.code)
    .all()

  const lineRows = db
    .select({
      accountId: journalEntryLines.accountId,
      debitMinor: journalEntryLines.debitMinor,
      creditMinor: journalEntryLines.creditMinor
    })
    .from(journalEntryLines)
    .where(eq(journalEntryLines.companyId, PRIMARY_COMPANY_ID))
    .all()

  const totalsByAccountId = new Map<string, { debit: number; credit: number }>()
  for (const line of lineRows) {
    const existing = totalsByAccountId.get(line.accountId) ?? { debit: 0, credit: 0 }
    existing.debit += line.debitMinor
    existing.credit += line.creditMinor
    totalsByAccountId.set(line.accountId, existing)
  }

  let grandTotalDebitMinor = 0
  let grandTotalCreditMinor = 0

  const accountBalances: TrialBalanceAccountRow[] = accountRows.map((row) => {
    const totals = totalsByAccountId.get(row.id) ?? { debit: 0, credit: 0 }
    const netMinor = totals.debit - totals.credit
    const closingDebitMinor = netMinor > 0 ? netMinor : 0
    const closingCreditMinor = netMinor < 0 ? -netMinor : 0

    grandTotalDebitMinor += totals.debit
    grandTotalCreditMinor += totals.credit

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      category: row.category as AccountCategory,
      subtype: row.subtype,
      normalBalance: deriveNormalBalance(row.category as AccountCategory),
      isActive: row.isActive,
      totalDebitMinor: totals.debit,
      totalCreditMinor: totals.credit,
      closingDebitMinor,
      closingCreditMinor
    }
  })

  return {
    accounts: accountBalances,
    grandTotalDebitMinor,
    grandTotalCreditMinor,
    isBalanced: grandTotalDebitMinor === grandTotalCreditMinor
  }
}
