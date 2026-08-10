/**
 * Slice 16's IPC surface covers both reads and manual mutations
 * (accounts.manage/journal_entries.manage), unlike Slice 15's own
 * entirely read-only surface — approved scope explicitly includes
 * manual account creation and manual journal posting/reversal, gated
 * by authorization rather than by the surface being read-only end to
 * end. There is still no mutation path for anything outside this
 * approved set: no update/delete for journal entries or lines, no
 * automatic/operational posting mechanism (that is Slice 17's own
 * scope), no draft/approval workflow, and no period-locking concept —
 * none of that exists anywhere in this codebase yet.
 */

export const ACCOUNTS_LIST_CHANNEL = 'accounts:list' as const
export const ACCOUNTS_GET_CHANNEL = 'accounts:get' as const
export const ACCOUNTS_CREATE_CHANNEL = 'accounts:create' as const
export const ACCOUNTS_UPDATE_CHANNEL = 'accounts:update' as const
export const ACCOUNTS_DEACTIVATE_CHANNEL = 'accounts:deactivate' as const
export const ACCOUNTS_REACTIVATE_CHANNEL = 'accounts:reactivate' as const

export const JOURNAL_ENTRIES_LIST_CHANNEL = 'journal-entries:list' as const
export const JOURNAL_ENTRIES_GET_CHANNEL = 'journal-entries:get' as const
export const JOURNAL_ENTRIES_CREATE_CHANNEL = 'journal-entries:create' as const
export const JOURNAL_ENTRIES_REVERSE_CHANNEL = 'journal-entries:reverse' as const

export const TRIAL_BALANCE_GET_CHANNEL = 'trial-balance:get' as const

export type AccountingErrorCode =
  | 'not_authorized'
  | 'invalid_input'
  | 'duplicate_code'
  | 'not_found'
  | 'session_invalid'
  | 'unbalanced_entry'
  | 'inactive_account'
  | 'already_reversed'
  | 'reversal_of_reversal'
  | 'unexpected_error'

export type AccountCategory =
  'asset' | 'liability' | 'equity' | 'revenue' | 'cost_of_goods_sold' | 'expense'

export type NormalBalance = 'debit' | 'credit'

/**
 * Deliberately excludes companyId (an internal, always-singleton
 * implementation detail the renderer has no use for and should never
 * see, mirroring every other Safe* type in this codebase's own
 * precedent).
 */
export interface SafeAccount {
  id: string
  code: string
  name: string
  category: AccountCategory
  subtype: string | null
  normalBalance: NormalBalance
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface SafeJournalEntryLine {
  id: string
  accountId: string
  accountCode: string
  accountName: string
  debitMinor: number
  creditMinor: number
  description: string | null
  lineOrder: number
}

/**
 * createdByUserId is included (it is a legitimate, safe reference —
 * mirroring stock_movements' own createdByUserId-equivalent precedent
 * of exposing the acting user's id), but createdByLabel is the
 * resolved display name, following the same resolve-a-label-for-the-
 * renderer pattern registerInventoryLotHandlers.ts's own
 * resolveItemLabels/resolveSupplierLabels established in Slice 15 —
 * present whenever the referenced user can still be resolved,
 * undefined only in the theoretical case it cannot (never thrown).
 * currencyId is included (it is always FUNCTIONAL_CURRENCY_ID, safe to
 * read), but is never accepted as caller input on create.
 */
export interface SafeJournalEntry {
  id: string
  entryNumber: string
  entryDate: number
  description: string
  externalReference: string | null
  currencyId: string
  createdByUserId: string
  createdByLabel: string | undefined
  reversedEntryId: string | null
  /**
   * True if some other journal entry's own reversedEntryId points back
   * at this entry — computed server-side (registerAccountingHandlers.ts
   * checks this directly against journal_entries), never something the
   * renderer infers on its own from a partial view of the data.
   * JournalEntryDetailScreen uses this, not a client-side guess, to
   * decide whether to hide the reversal control for an entry that has
   * already been reversed once.
   */
  hasBeenReversed: boolean
  reversalReason: string | null
  createdAt: number
  lines: SafeJournalEntryLine[]
}

export interface SafeTrialBalanceRow {
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

export interface SafeTrialBalance {
  accounts: SafeTrialBalanceRow[]
  grandTotalDebitMinor: number
  grandTotalCreditMinor: number
  isBalanced: boolean
}

export interface AccountIdInput {
  id: string
}

export interface JournalEntryIdInput {
  id: string
}

/**
 * code/name/category only — isActive/companyId/createdAt/updatedAt are
 * structurally absent, a compile-time guarantee mirroring
 * chartOfAccountsService.ts's own CreateAccountInput.
 */
export interface CreateAccountRendererInput {
  code: string
  name: string
  category: string
  subtype?: string | null
}

/**
 * id + name/subtype only — code and category are structurally absent,
 * mirroring UpdateAccountInput's own immutability guarantee exactly.
 */
export interface UpdateAccountRendererInput {
  id: string
  name?: string
  subtype?: string | null
}

export interface JournalEntryLineRendererInput {
  accountId: string
  debitMinor: number
  creditMinor: number
  description?: string | null
}

/**
 * entryDate/description/externalReference/lines only —
 * createdByUserId/currencyId/entryNumber/reversedEntryId are all
 * structurally absent; the handler computes createdByUserId from the
 * authenticated caller and assigns lineOrder from array order, never
 * from caller-supplied data.
 */
export interface CreateJournalEntryRendererInput {
  entryDate: number
  description: string
  externalReference?: string | null
  lines: JournalEntryLineRendererInput[]
}

export interface ReverseJournalEntryRendererInput {
  journalEntryId: string
  reversalReason: string
}

export type ListAccountsResult =
  { success: true; accounts: SafeAccount[] } | { success: false; errorCode: AccountingErrorCode }

export type GetAccountResult =
  { success: true; account: SafeAccount } | { success: false; errorCode: AccountingErrorCode }

export type MutateAccountResult =
  { success: true; account: SafeAccount } | { success: false; errorCode: AccountingErrorCode }

export type ListJournalEntriesResult =
  | { success: true; entries: SafeJournalEntry[] }
  | { success: false; errorCode: AccountingErrorCode }

export type GetJournalEntryResult =
  { success: true; entry: SafeJournalEntry } | { success: false; errorCode: AccountingErrorCode }

export type MutateJournalEntryResult =
  { success: true; entry: SafeJournalEntry } | { success: false; errorCode: AccountingErrorCode }

export type GetTrialBalanceResult =
  | { success: true; trialBalance: SafeTrialBalance }
  | { success: false; errorCode: AccountingErrorCode }

export interface LedgerPageAccountingApi {
  listAccounts: () => Promise<ListAccountsResult>
  getAccount: (input: AccountIdInput) => Promise<GetAccountResult>
  createAccount: (input: CreateAccountRendererInput) => Promise<MutateAccountResult>
  updateAccount: (input: UpdateAccountRendererInput) => Promise<MutateAccountResult>
  deactivateAccount: (input: AccountIdInput) => Promise<MutateAccountResult>
  reactivateAccount: (input: AccountIdInput) => Promise<MutateAccountResult>

  listJournalEntries: () => Promise<ListJournalEntriesResult>
  getJournalEntry: (input: JournalEntryIdInput) => Promise<GetJournalEntryResult>
  createJournalEntry: (input: CreateJournalEntryRendererInput) => Promise<MutateJournalEntryResult>
  reverseJournalEntry: (
    input: ReverseJournalEntryRendererInput
  ) => Promise<MutateJournalEntryResult>

  getTrialBalance: () => Promise<GetTrialBalanceResult>
}
