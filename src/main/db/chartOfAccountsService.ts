import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { accounts, company, PRIMARY_COMPANY_ID } from './schema'
import {
  deriveNormalBalance,
  normalizeAccountSubtype,
  requireTrimmedAccountName,
  requireValidAccountCategory,
  requireValidAccountCode,
  type AccountCategory,
  type NormalBalance
} from './validation/accountValidation'
import { STARTER_ACCOUNT_DEFINITIONS } from './starterAccounts'
import { record, type AuditActor } from '../audit/auditService'
import type { AppDb } from './dbTypes'

export class ChartOfAccountsServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChartOfAccountsServiceError'
  }
}

export interface Account {
  id: string
  companyId: string
  code: string
  name: string
  category: AccountCategory
  subtype: string | null
  normalBalance: NormalBalance
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateAccountInput {
  code: string
  name: string
  category: string
  subtype?: string | null
}

export interface UpdateAccountInput {
  name?: string
  subtype?: string | null
}

function toAccount(row: typeof accounts.$inferSelect): Account {
  const category = row.category as AccountCategory
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    category,
    subtype: row.subtype,
    normalBalance: deriveNormalBalance(category),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function getAccountById(db: AppDb, id: string): Account | undefined {
  const row = db.select().from(accounts).where(eq(accounts.id, id)).get()
  return row ? toAccount(row) : undefined
}

export function getAccountByCode(db: AppDb, code: string): Account | undefined {
  const row = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, PRIMARY_COMPANY_ID), eq(accounts.code, code)))
    .get()
  return row ? toAccount(row) : undefined
}

/**
 * Inactive accounts remain readable — this list is never filtered by
 * isActive, mirroring every prior master-data service's own precedent
 * (customers/suppliers/inventory items/products all keep inactive rows
 * fully visible to listAccounts, only excluding them from new
 * assignment).
 */
export function listAccounts(db: AppDb): Account[] {
  const rows = db
    .select()
    .from(accounts)
    .where(eq(accounts.companyId, PRIMARY_COMPANY_ID))
    .orderBy(accounts.code)
    .all()
  return rows.map(toAccount)
}

function requireCompanyExists(db: AppDb): void {
  const found = db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.id, PRIMARY_COMPANY_ID))
    .get()
  if (!found) {
    throw new ChartOfAccountsServiceError(
      'Cannot manage accounts: no company profile exists yet. Complete first-run setup first.'
    )
  }
}

function requireUniqueCode(db: AppDb, code: string, excludeAccountId?: string): void {
  const existing = getAccountByCode(db, code)
  if (existing && existing.id !== excludeAccountId) {
    throw new ChartOfAccountsServiceError(`An account with code "${code}" already exists`)
  }
}

/**
 * code and category must both be given for a new account, but are then
 * structurally impossible to change again — UpdateAccountInput has no
 * code or category field at all, a compile-time guarantee mirroring
 * inventoryLotService's own internalLotNumber-is-absent-from-every-
 * mutation-input precedent.
 */
export function createAccount(
  db: AppDb,
  input: CreateAccountInput,
  actor: AuditActor,
  now: Date = new Date()
): Account {
  requireCompanyExists(db)

  const code = requireValidAccountCode(input.code)
  const name = requireTrimmedAccountName(input.name)
  const category = requireValidAccountCategory(input.category)
  const subtype = normalizeAccountSubtype(input.subtype)

  requireUniqueCode(db, code)

  const id = `account_${randomUUID()}`

  db.transaction((tx) => {
    tx.insert(accounts)
      .values({
        id,
        companyId: PRIMARY_COMPANY_ID,
        code,
        name,
        category,
        subtype,
        isActive: true,
        createdAt: now,
        updatedAt: now
      })
      .run()

    record(
      tx,
      {
        entityType: 'account',
        entityId: id,
        entityLabel: `${code} ${name}`,
        action: 'create',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: null,
        after: { code, name, category, subtype, isActive: true }
      },
      now
    )
  })

  const created = getAccountById(db, id)
  if (!created) {
    throw new ChartOfAccountsServiceError('Account was not persisted after creation')
  }
  return created
}

/**
 * code and category are structurally absent from UpdateAccountInput —
 * there is no way to accidentally forward them. Only name and subtype
 * may change. A no-op update (nothing actually different from the
 * existing row) writes no audit row, relying on record()'s own
 * before/after diff to detect that nothing changed, mirroring
 * updateInventoryItem's own exact pattern.
 */
export function updateAccount(
  db: AppDb,
  id: string,
  input: UpdateAccountInput,
  actor: AuditActor,
  now: Date = new Date()
): Account {
  const existing = getAccountById(db, id)
  if (!existing) {
    throw new ChartOfAccountsServiceError(`No account exists with id "${id}"`)
  }

  const name = input.name !== undefined ? requireTrimmedAccountName(input.name) : existing.name
  const subtype =
    input.subtype !== undefined ? normalizeAccountSubtype(input.subtype) : existing.subtype

  db.transaction((tx) => {
    tx.update(accounts).set({ name, subtype, updatedAt: now }).where(eq(accounts.id, id)).run()

    record(
      tx,
      {
        entityType: 'account',
        entityId: id,
        entityLabel: `${existing.code} ${name}`,
        action: 'update',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: { name: existing.name, subtype: existing.subtype },
        after: { name, subtype }
      },
      now
    )
  })

  const updated = getAccountById(db, id)
  if (!updated) {
    throw new ChartOfAccountsServiceError('Account disappeared during update')
  }
  return updated
}

function setAccountActive(
  db: AppDb,
  id: string,
  isActive: boolean,
  actor: AuditActor,
  now: Date
): Account {
  const existing = getAccountById(db, id)
  if (!existing) {
    throw new ChartOfAccountsServiceError(`No account exists with id "${id}"`)
  }
  if (existing.isActive === isActive) {
    return existing
  }

  db.transaction((tx) => {
    tx.update(accounts).set({ isActive, updatedAt: now }).where(eq(accounts.id, id)).run()

    record(
      tx,
      {
        entityType: 'account',
        entityId: id,
        entityLabel: `${existing.code} ${existing.name}`,
        action: isActive ? 'reactivate' : 'deactivate',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: { isActive: existing.isActive },
        after: { isActive }
      },
      now
    )
  })

  const updated = getAccountById(db, id)
  if (!updated) {
    throw new ChartOfAccountsServiceError('Account disappeared during status change')
  }
  return updated
}

export function deactivateAccount(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): Account {
  return setAccountActive(db, id, false, actor, now)
}

export function reactivateAccount(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): Account {
  return setAccountActive(db, id, true, actor, now)
}

/**
 * A service-layer helper for later use by journalEntryService.ts (and
 * any future poster) — not itself a database CHECK constraint, since
 * "was this account active at the moment this specific historical line
 * was posted" is not expressible as one. New manual postings must
 * target an active account; reversals are explicitly exempted by
 * journalEntryService.ts itself (undoing a past action must work even
 * after later, unrelated deactivation), so this helper is deliberately
 * not called from the reversal path at all.
 */
export function requireActiveAccountForPosting(db: AppDb, accountId: string): Account {
  const account = getAccountById(db, accountId)
  if (!account) {
    throw new ChartOfAccountsServiceError(`No account exists with id "${accountId}"`)
  }
  if (!account.isActive) {
    throw new ChartOfAccountsServiceError(
      `Account "${account.code} ${account.name}" is not active; it cannot receive a new manual posting`
    )
  }
  return account
}

/**
 * Idempotent: inserts every starter account whose code does not
 * already exist for this company, and leaves every pre-existing row
 * (starter or user-created) completely untouched — this is "ensure
 * present," never "reset to defaults." Runs both from first-run setup
 * (new companies) and from an upgrade-detection path for companies
 * that upgraded from m1-slice-15 without ever running first-run setup
 * again. All inserts happen in a single transaction, each with its own
 * audit row (never one combined row for the whole batch), mirroring
 * seedReferenceData's own per-row audit precedent. Creates no journal
 * entry and no opening balance — see starterAccounts.ts's own doc
 * comment for the reasoning.
 */
export function ensureStarterChartOfAccounts(
  db: AppDb,
  actor: AuditActor,
  now: Date = new Date()
): void {
  requireCompanyExists(db)

  const existingCodes = new Set(
    db
      .select({ code: accounts.code })
      .from(accounts)
      .where(eq(accounts.companyId, PRIMARY_COMPANY_ID))
      .all()
      .map((row) => row.code)
  )

  const missing = STARTER_ACCOUNT_DEFINITIONS.filter(
    (definition) => !existingCodes.has(definition.code)
  )
  if (missing.length === 0) {
    return
  }

  db.transaction((tx) => {
    for (const definition of missing) {
      const id = `account_${randomUUID()}`
      tx.insert(accounts)
        .values({
          id,
          companyId: PRIMARY_COMPANY_ID,
          code: definition.code,
          name: definition.name,
          category: definition.category,
          subtype: definition.subtype,
          isActive: true,
          createdAt: now,
          updatedAt: now
        })
        .run()

      record(
        tx,
        {
          entityType: 'account',
          entityId: id,
          entityLabel: `${definition.code} ${definition.name}`,
          action: 'create',
          actor,
          companyId: PRIMARY_COMPANY_ID,
          before: null,
          after: {
            code: definition.code,
            name: definition.name,
            category: definition.category,
            subtype: definition.subtype,
            isActive: true
          }
        },
        now
      )
    }
  })
}
