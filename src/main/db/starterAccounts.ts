import type { ACCOUNT_CATEGORIES } from './schema'

export type AccountCategory = (typeof ACCOUNT_CATEGORIES)[number]

export interface StarterAccountDefinition {
  code: string
  name: string
  category: AccountCategory
  subtype: string
}

/**
 * The frozen starter chart of accounts (approved decision) — seeded
 * idempotently at zero balance, for both new first-run companies and
 * existing companies upgrading from m1-slice-15. Deliberately does
 * *not* create any opening-balance journal entry while seeding these
 * rows: an account existing with a zero cached balance is not itself a
 * financial fact requiring a journal entry — opening balances, if and
 * when a company needs to record them, are ordinary manual journal
 * entries a user creates afterward, exactly like any other entry.
 *
 * Every code here is a caller-supplied, immutable, curated accounting
 * code (not a numbering-rule-generated sequence) — see accounts' own
 * schema comment for the full reasoning. Every category/subtype pair is
 * frozen exactly as approved; ensureStarterChartOfAccounts must insert
 * exactly these 13 rows, in this order, and must never modify a
 * pre-existing row with a matching code (idempotent, not "reset to
 * defaults").
 */
export const STARTER_ACCOUNT_DEFINITIONS: readonly StarterAccountDefinition[] = [
  { code: '1000', name: 'Cash on Hand', category: 'asset', subtype: 'cash' },
  { code: '1010', name: 'Primary Bank', category: 'asset', subtype: 'bank' },
  { code: '1020', name: 'Mobile Money', category: 'asset', subtype: 'mobile_money' },
  { code: '1030', name: 'Petty Cash', category: 'asset', subtype: 'petty_cash' },
  {
    code: '1040',
    name: 'Undeposited Funds',
    category: 'asset',
    subtype: 'undeposited_funds'
  },
  {
    code: '1100',
    name: 'Accounts Receivable',
    category: 'asset',
    subtype: 'accounts_receivable'
  },
  { code: '1200', name: 'Inventory', category: 'asset', subtype: 'inventory' },
  {
    code: '2000',
    name: 'Accounts Payable',
    category: 'liability',
    subtype: 'accounts_payable'
  },
  { code: '3000', name: "Owner's Equity", category: 'equity', subtype: 'owners_equity' },
  {
    code: '3100',
    name: 'Retained Earnings',
    category: 'equity',
    subtype: 'retained_earnings'
  },
  { code: '4000', name: 'Sales Revenue', category: 'revenue', subtype: 'sales' },
  {
    code: '5000',
    name: 'Cost of Goods Sold',
    category: 'cost_of_goods_sold',
    subtype: 'cost_of_goods_sold'
  },
  {
    code: '6000',
    name: 'General Expenses',
    category: 'expense',
    subtype: 'general_expense'
  }
]
