import { ipcMain } from 'electron'
import { eq } from 'drizzle-orm'
import {
  ACCOUNTS_CREATE_CHANNEL,
  ACCOUNTS_DEACTIVATE_CHANNEL,
  ACCOUNTS_GET_CHANNEL,
  ACCOUNTS_LIST_CHANNEL,
  ACCOUNTS_REACTIVATE_CHANNEL,
  ACCOUNTS_UPDATE_CHANNEL,
  JOURNAL_ENTRIES_CREATE_CHANNEL,
  JOURNAL_ENTRIES_GET_CHANNEL,
  JOURNAL_ENTRIES_LIST_CHANNEL,
  JOURNAL_ENTRIES_REVERSE_CHANNEL,
  TRIAL_BALANCE_GET_CHANNEL,
  type AccountIdInput,
  type AccountingErrorCode,
  type CreateAccountRendererInput,
  type CreateJournalEntryRendererInput,
  type GetAccountResult,
  type GetJournalEntryResult,
  type GetTrialBalanceResult,
  type JournalEntryIdInput,
  type JournalEntryLineRendererInput,
  type ListAccountsResult,
  type ListJournalEntriesResult,
  type MutateAccountResult,
  type MutateJournalEntryResult,
  type ReverseJournalEntryRendererInput,
  type SafeAccount,
  type SafeJournalEntry,
  type SafeJournalEntryLine,
  type SafeTrialBalance,
  type UpdateAccountRendererInput
} from '../../shared/ipc/accounting'
import type { NavigationPolicyContext } from '../security/navigationPolicy'
import { isApprovedIpcSender, type ApprovableIpcEvent } from '../security/senderValidation'
import { requireAuthorizedCaller } from '../auth/requireAuthorizedCaller'
import type { LoginService } from '../users/loginService'
import {
  createAccount,
  deactivateAccount,
  getAccountById,
  listAccounts,
  reactivateAccount,
  updateAccount,
  ChartOfAccountsServiceError,
  type Account
} from '../db/chartOfAccountsService'
import { AccountValidationError } from '../db/validation/accountValidation'
import {
  createJournalEntry,
  getJournalEntryById,
  listJournalEntries,
  reverseJournalEntry,
  JournalEntryServiceError,
  type JournalEntry
} from '../db/journalEntryService'
import { JournalEntryValidationError } from '../db/validation/journalEntryValidation'
import { getTrialBalance } from '../db/trialBalanceService'
import { users, journalEntries } from '../db/schema'
import type { AppDb } from '../db/dbTypes'

class AccountingIpcInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountingIpcInputError'
  }
}

function requireApprovedSender(event: ApprovableIpcEvent, context: NavigationPolicyContext): void {
  if (!isApprovedIpcSender(event, context)) {
    throw new Error('LedgerPage: rejected accounting request from an unapproved sender')
  }
}

function requireStringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AccountingIpcInputError(`${fieldName} must be a non-empty string`)
  }
  return value
}

function optionalStringField(value: unknown, fieldName: string): string | null | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw new AccountingIpcInputError(`${fieldName} must be a string or null`)
  }
  return value
}

function requireFiniteNumberField(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AccountingIpcInputError(`${fieldName} must be a finite number`)
  }
  return value
}

function requireObject(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null) {
    throw new AccountingIpcInputError('input must be an object')
  }
  return input as Record<string, unknown>
}

function parseAccountIdInput(input: unknown): AccountIdInput {
  const candidate = requireObject(input)
  return { id: requireStringField(candidate.id, 'id') }
}

function parseJournalEntryIdInput(input: unknown): JournalEntryIdInput {
  const candidate = requireObject(input)
  return { id: requireStringField(candidate.id, 'id') }
}

/**
 * Only code/name/category/subtype are ever read from the raw input —
 * any other property the renderer might supply (isActive, companyId,
 * createdAt, updatedAt, id) is silently ignored, never forwarded to
 * the service layer, since this function never reads those keys at
 * all.
 */
function parseCreateAccountInput(input: unknown): CreateAccountRendererInput {
  const candidate = requireObject(input)
  return {
    code: requireStringField(candidate.code, 'code'),
    name: requireStringField(candidate.name, 'name'),
    category: requireStringField(candidate.category, 'category'),
    subtype: optionalStringField(candidate.subtype, 'subtype')
  }
}

/**
 * Only id/name/subtype are ever read — code and category are
 * structurally impossible to forward from this parser even if the
 * renderer supplies them, since this function never reads those keys.
 */
function parseUpdateAccountInput(input: unknown): UpdateAccountRendererInput {
  const candidate = requireObject(input)
  const result: UpdateAccountRendererInput = { id: requireStringField(candidate.id, 'id') }
  if (candidate.name !== undefined) {
    result.name = requireStringField(candidate.name, 'name')
  }
  if (candidate.subtype !== undefined) {
    result.subtype = optionalStringField(candidate.subtype, 'subtype') ?? null
  }
  return result
}

function parseJournalEntryLineInput(raw: unknown, index: number): JournalEntryLineRendererInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new AccountingIpcInputError(`lines[${index}] must be an object`)
  }
  const candidate = raw as Record<string, unknown>
  return {
    accountId: requireStringField(candidate.accountId, `lines[${index}].accountId`),
    debitMinor: requireFiniteNumberField(candidate.debitMinor, `lines[${index}].debitMinor`),
    creditMinor: requireFiniteNumberField(candidate.creditMinor, `lines[${index}].creditMinor`),
    description: optionalStringField(candidate.description, `lines[${index}].description`)
  }
}

/**
 * Only entryDate/description/externalReference/lines are ever read.
 * createdByUserId, currencyId, entryNumber, and reversedEntryId are
 * never read from the raw input at all — the handler computes
 * createdByUserId from the authenticated caller itself, and
 * journalEntryService.ts's own createJournalEntry always assigns
 * currencyId/entryNumber/reversedEntryId server-side regardless of
 * what this parser produces. Line order is taken from the array's own
 * position (forEach index), never from a caller-supplied lineOrder
 * field — this parser's own per-line shape
 * (JournalEntryLineRendererInput) has no lineOrder or id field to even
 * read from.
 */
function parseCreateJournalEntryInput(input: unknown): CreateJournalEntryRendererInput {
  const candidate = requireObject(input)
  const entryDate = requireFiniteNumberField(candidate.entryDate, 'entryDate')
  const description = requireStringField(candidate.description, 'description')
  const externalReference = optionalStringField(candidate.externalReference, 'externalReference')
  if (!Array.isArray(candidate.lines)) {
    throw new AccountingIpcInputError('lines must be an array')
  }
  const lines = candidate.lines.map((line, index) => parseJournalEntryLineInput(line, index))
  return { entryDate, description, externalReference, lines }
}

function parseReverseJournalEntryInput(input: unknown): ReverseJournalEntryRendererInput {
  const candidate = requireObject(input)
  return {
    journalEntryId: requireStringField(candidate.journalEntryId, 'journalEntryId'),
    reversalReason: requireStringField(candidate.reversalReason, 'reversalReason')
  }
}

function toSafeAccount(account: Account): SafeAccount {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    category: account.category,
    subtype: account.subtype,
    normalBalance: account.normalBalance,
    isActive: account.isActive,
    createdAt: account.createdAt.getTime(),
    updatedAt: account.updatedAt.getTime()
  }
}

function resolveUserLabel(db: AppDb, userId: string): string | undefined {
  const row = db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  return row?.displayName
}

interface ResolvedAccountLabels {
  accountCode: string
  accountName: string
}

function resolveAccountLabels(db: AppDb, accountId: string): ResolvedAccountLabels {
  const account = getAccountById(db, accountId)
  return {
    accountCode: account?.code ?? '',
    accountName: account?.name ?? ''
  }
}

function toSafeJournalEntryLine(
  db: AppDb,
  line: JournalEntry['lines'][number]
): SafeJournalEntryLine {
  const { accountCode, accountName } = resolveAccountLabels(db, line.accountId)
  return {
    id: line.id,
    accountId: line.accountId,
    accountCode,
    accountName,
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    description: line.description,
    lineOrder: line.lineOrder
  }
}

function entryHasBeenReversed(db: AppDb, entryId: string): boolean {
  const existingReversal = db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.reversedEntryId, entryId))
    .get()
  return existingReversal !== undefined
}

function toSafeJournalEntry(db: AppDb, entry: JournalEntry): SafeJournalEntry {
  return {
    id: entry.id,
    entryNumber: entry.entryNumber,
    entryDate: entry.entryDate.getTime(),
    description: entry.description,
    externalReference: entry.externalReference,
    currencyId: entry.currencyId,
    createdByUserId: entry.createdByUserId,
    createdByLabel: resolveUserLabel(db, entry.createdByUserId),
    reversedEntryId: entry.reversedEntryId,
    hasBeenReversed: entryHasBeenReversed(db, entry.id),
    reversalReason: entry.reversalReason,
    createdAt: entry.createdAt.getTime(),
    lines: entry.lines.map((line) => toSafeJournalEntryLine(db, line))
  }
}

function toSafeTrialBalance(trialBalance: ReturnType<typeof getTrialBalance>): SafeTrialBalance {
  return {
    accounts: trialBalance.accounts.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      category: row.category,
      subtype: row.subtype,
      normalBalance: row.normalBalance,
      isActive: row.isActive,
      totalDebitMinor: row.totalDebitMinor,
      totalCreditMinor: row.totalCreditMinor,
      closingDebitMinor: row.closingDebitMinor,
      closingCreditMinor: row.closingCreditMinor
    })),
    grandTotalDebitMinor: trialBalance.grandTotalDebitMinor,
    grandTotalCreditMinor: trialBalance.grandTotalCreditMinor,
    isBalanced: trialBalance.isBalanced
  }
}

/**
 * Maps a thrown service-layer error to a safe, fixed errorCode — never
 * forwarding the error's own raw message to the renderer, mirroring
 * every other handler file's own error-mapping posture in this
 * codebase.
 */
function toErrorCode(error: unknown): AccountingErrorCode {
  if (error instanceof AccountValidationError) {
    return 'invalid_input'
  }
  if (error instanceof JournalEntryValidationError) {
    const message = error.message
    if (message.includes('at least two lines') || message.includes('exactly one of')) {
      return 'invalid_input'
    }
    if (message.includes('must equal total credits') || message.includes('greater than zero')) {
      return 'unbalanced_entry'
    }
    return 'invalid_input'
  }
  if (error instanceof ChartOfAccountsServiceError) {
    if (error.message.includes('already exists')) {
      return 'duplicate_code'
    }
    if (error.message.includes('not active')) {
      return 'inactive_account'
    }
    if (error.message.includes('No account exists')) {
      return 'not_found'
    }
    return 'invalid_input'
  }
  if (error instanceof JournalEntryServiceError) {
    if (error.message.includes('is not active')) {
      return 'inactive_account'
    }
    if (error.message.includes('is itself a reversal')) {
      return 'reversal_of_reversal'
    }
    if (error.message.includes('has already been reversed')) {
      return 'already_reversed'
    }
    if (error.message.includes('No journal entry exists')) {
      return 'not_found'
    }
    return 'invalid_input'
  }
  return 'unexpected_error'
}

/**
 * requireAuthorizedCaller itself can throw an unexpected error (e.g. a
 * database-connection problem while resolving the caller's session or
 * fresh role codes) -- this wrapper ensures that possibility is caught
 * and safely mapped exactly like every other unexpected error in this
 * file, rather than propagating uncaught out of a handler and
 * potentially surfacing a raw exception to the renderer. Every one of
 * this file's 11 handlers calls this wrapper, never the raw
 * requireAuthorizedCaller directly. The return type is deliberately
 * wider than requireAuthorizedCaller's own (which only ever produces
 * 'session_invalid' | 'not_authorized') since this wrapper can also
 * produce 'unexpected_error', a genuinely different case the caller
 * needs to be able to return.
 */
type SafeRequireAuthorizedCallerResult =
  { ok: true; callerUserId: string } | { ok: false; errorCode: AccountingErrorCode }

function safeRequireAuthorizedCaller(
  db: AppDb,
  loginService: LoginService,
  action: Parameters<typeof requireAuthorizedCaller>[2]
): SafeRequireAuthorizedCallerResult {
  try {
    return requireAuthorizedCaller(db, loginService, action)
  } catch (error) {
    return { ok: false, errorCode: toErrorCode(error) }
  }
}

export interface RegisterAccountingHandlersOptions {
  context: NavigationPolicyContext
  db: AppDb
  loginService: LoginService
}

/**
 * Registers Slice 16's entire IPC surface: exactly 11 channels — 6 for
 * accounts (list/get/create/update/deactivate/reactivate), 4 for
 * journal entries (list/get/create/reverse), and 1 for the trial
 * balance. Every handler is gated by requireAuthorizedCaller against
 * the matching action (accounts.read/accounts.manage/
 * journal_entries.read/journal_entries.manage), resolved fresh from
 * SQLite on every call. The audit actor and createdByUserId are always
 * computed from requireAuthorizedCaller's own resolved callerUserId —
 * never from any renderer-supplied actor/actorId/createdByUserId
 * field, since the parsers above never even read such a field from the
 * raw input.
 */
export function registerAccountingHandlers(options: RegisterAccountingHandlersOptions): void {
  const { context, db, loginService } = options

  ipcMain.handle(ACCOUNTS_LIST_CHANNEL, (event): ListAccountsResult => {
    requireApprovedSender(event, context)
    const authResult = safeRequireAuthorizedCaller(db, loginService, 'accounts.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }
    try {
      return { success: true, accounts: listAccounts(db).map(toSafeAccount) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(ACCOUNTS_GET_CHANNEL, (event, rawInput: unknown): GetAccountResult => {
    requireApprovedSender(event, context)

    let input: AccountIdInput
    try {
      input = parseAccountIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = safeRequireAuthorizedCaller(db, loginService, 'accounts.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    const account = getAccountById(db, input.id)
    if (!account) {
      return { success: false, errorCode: 'not_found' }
    }
    return { success: true, account: toSafeAccount(account) }
  })

  ipcMain.handle(ACCOUNTS_CREATE_CHANNEL, (event, rawInput: unknown): MutateAccountResult => {
    requireApprovedSender(event, context)

    let input: CreateAccountRendererInput
    try {
      input = parseCreateAccountInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = safeRequireAuthorizedCaller(db, loginService, 'accounts.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const account = createAccount(db, input, {
        type: 'user',
        userId: authResult.callerUserId
      })
      return { success: true, account: toSafeAccount(account) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(ACCOUNTS_UPDATE_CHANNEL, (event, rawInput: unknown): MutateAccountResult => {
    requireApprovedSender(event, context)

    let input: UpdateAccountRendererInput
    try {
      input = parseUpdateAccountInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = safeRequireAuthorizedCaller(db, loginService, 'accounts.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const account = updateAccount(
        db,
        input.id,
        { name: input.name, subtype: input.subtype },
        { type: 'user', userId: authResult.callerUserId }
      )
      return { success: true, account: toSafeAccount(account) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(ACCOUNTS_DEACTIVATE_CHANNEL, (event, rawInput: unknown): MutateAccountResult => {
    requireApprovedSender(event, context)

    let input: AccountIdInput
    try {
      input = parseAccountIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = safeRequireAuthorizedCaller(db, loginService, 'accounts.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const account = deactivateAccount(db, input.id, {
        type: 'user',
        userId: authResult.callerUserId
      })
      return { success: true, account: toSafeAccount(account) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(ACCOUNTS_REACTIVATE_CHANNEL, (event, rawInput: unknown): MutateAccountResult => {
    requireApprovedSender(event, context)

    let input: AccountIdInput
    try {
      input = parseAccountIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = safeRequireAuthorizedCaller(db, loginService, 'accounts.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const account = reactivateAccount(db, input.id, {
        type: 'user',
        userId: authResult.callerUserId
      })
      return { success: true, account: toSafeAccount(account) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(JOURNAL_ENTRIES_LIST_CHANNEL, (event): ListJournalEntriesResult => {
    requireApprovedSender(event, context)
    const authResult = safeRequireAuthorizedCaller(db, loginService, 'journal_entries.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }
    try {
      return {
        success: true,
        entries: listJournalEntries(db).map((entry) => toSafeJournalEntry(db, entry))
      }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(JOURNAL_ENTRIES_GET_CHANNEL, (event, rawInput: unknown): GetJournalEntryResult => {
    requireApprovedSender(event, context)

    let input: JournalEntryIdInput
    try {
      input = parseJournalEntryIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = safeRequireAuthorizedCaller(db, loginService, 'journal_entries.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    const entry = getJournalEntryById(db, input.id)
    if (!entry) {
      return { success: false, errorCode: 'not_found' }
    }
    return { success: true, entry: toSafeJournalEntry(db, entry) }
  })

  ipcMain.handle(
    JOURNAL_ENTRIES_CREATE_CHANNEL,
    (event, rawInput: unknown): MutateJournalEntryResult => {
      requireApprovedSender(event, context)

      let input: CreateJournalEntryRendererInput
      try {
        input = parseCreateJournalEntryInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = safeRequireAuthorizedCaller(db, loginService, 'journal_entries.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const entry = createJournalEntry(
          db,
          {
            entryDate: new Date(input.entryDate),
            description: input.description,
            externalReference: input.externalReference,
            lines: input.lines
          },
          { type: 'user', userId: authResult.callerUserId }
        )
        return { success: true, entry: toSafeJournalEntry(db, entry) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    JOURNAL_ENTRIES_REVERSE_CHANNEL,
    (event, rawInput: unknown): MutateJournalEntryResult => {
      requireApprovedSender(event, context)

      let input: ReverseJournalEntryRendererInput
      try {
        input = parseReverseJournalEntryInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = safeRequireAuthorizedCaller(db, loginService, 'journal_entries.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const entry = reverseJournalEntry(db, input.journalEntryId, input.reversalReason, {
          type: 'user',
          userId: authResult.callerUserId
        })
        return { success: true, entry: toSafeJournalEntry(db, entry) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(TRIAL_BALANCE_GET_CHANNEL, (event): GetTrialBalanceResult => {
    requireApprovedSender(event, context)
    const authResult = safeRequireAuthorizedCaller(db, loginService, 'journal_entries.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }
    try {
      return { success: true, trialBalance: toSafeTrialBalance(getTrialBalance(db)) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })
}
