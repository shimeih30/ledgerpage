import { eq } from 'drizzle-orm'
import { company, currencies, PRIMARY_COMPANY_ID } from './schema'
import {
  CompanyValidationError,
  normalizeOptionalText,
  requireTrimmedText,
  validateManagedRelativeLogoPath
} from './validation/companyValidation'
import type { AppDb } from './dbTypes'

export class CompanySingletonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompanySingletonError'
  }
}

export class CompanyNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompanyNotFoundError'
  }
}

export interface Company {
  id: string
  name: string
  tradingName: string | null
  address: string
  contactDetails: string
  currencyId: string
  vatRegistered: boolean
  logoAssetPath: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateCompanyInput {
  name: string
  tradingName?: string | null
  address: string
  contactDetails: string
  currencyId: string
  vatRegistered?: boolean
  logoAssetPath?: string | null
}

export interface UpdateCompanyInput {
  name?: string
  tradingName?: string | null
  address?: string
  contactDetails?: string
  currencyId?: string
  vatRegistered?: boolean
  logoAssetPath?: string | null
}

/**
 * Every function below operates exclusively on the fixed row identified
 * by PRIMARY_COMPANY_ID. None of them accept an `id` parameter from any
 * caller — there is no code path through this module capable of even
 * attempting to create, read, or update a differently-identified company
 * row. The database's own CHECK/PRIMARY KEY constraints (see schema.ts)
 * are the ultimate enforcement; this is the service-level half of that
 * same guarantee.
 */

function requireCurrencyExists(db: AppDb, currencyId: string): void {
  const found = db
    .select({ id: currencies.id })
    .from(currencies)
    .where(eq(currencies.id, currencyId))
    .get()
  if (!found) {
    throw new CompanyValidationError(
      `currencyId "${currencyId}" does not reference an existing currency`
    )
  }
}

/**
 * Reads the singleton company row. Returns undefined if it doesn't exist
 * yet — this is the documented "not created yet" result, not an error;
 * callers (e.g. a future settings screen, or Slice 8's wizard deciding
 * whether to show itself) are expected to check for undefined rather
 * than catch an exception for the ordinary pre-first-run state.
 */
export function getCompany(db: AppDb): Company | undefined {
  const row = db.select().from(company).where(eq(company.id, PRIMARY_COMPANY_ID)).get()
  return row ? toCompany(row) : undefined
}

/**
 * Creates the singleton company row. Intended for use by Slice 8's
 * first-run transaction (pass the transaction-scoped db so this composes
 * into that larger atomic operation) — this slice does not call it
 * during startup.
 *
 * Throws CompanySingletonError if a company row already exists — checked
 * explicitly here (for a clear error message) in addition to the
 * database's own PRIMARY KEY/CHECK constraints, which remain the actual
 * enforcement of last resort.
 */
export function createCompany(
  db: AppDb,
  input: CreateCompanyInput,
  now: Date = new Date()
): Company {
  const existing = db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.id, PRIMARY_COMPANY_ID))
    .get()
  if (existing) {
    throw new CompanySingletonError('A company profile already exists; it cannot be created twice')
  }

  const name = requireTrimmedText(input.name, 'name')
  const address = requireTrimmedText(input.address, 'address')
  const contactDetails = requireTrimmedText(input.contactDetails, 'contactDetails')
  const tradingName = normalizeOptionalText(input.tradingName)
  const logoAssetPath =
    input.logoAssetPath == null ? null : validateManagedRelativeLogoPath(input.logoAssetPath)

  requireCurrencyExists(db, input.currencyId)

  db.insert(company)
    .values({
      id: PRIMARY_COMPANY_ID,
      name,
      tradingName,
      address,
      contactDetails,
      currencyId: input.currencyId,
      vatRegistered: input.vatRegistered ?? false,
      logoAssetPath,
      createdAt: now,
      updatedAt: now
    })
    .run()

  const created = getCompany(db)
  if (!created) {
    throw new CompanySingletonError('Company row was not persisted after creation')
  }
  return created
}

/**
 * Updates the singleton company row. Preserves `id` and `createdAt`
 * unconditionally; only fields actually present in `input` are changed;
 * `updatedAt` always advances to `now`.
 *
 * Throws CompanyNotFoundError if no company row exists yet — there is
 * nothing to update before Slice 8's first-run transaction has run.
 */
export function updateCompany(
  db: AppDb,
  input: UpdateCompanyInput,
  now: Date = new Date()
): Company {
  const existing = db.select().from(company).where(eq(company.id, PRIMARY_COMPANY_ID)).get()
  if (!existing) {
    throw new CompanyNotFoundError('Cannot update company: no company profile exists yet')
  }

  const patch: Partial<typeof company.$inferInsert> = { updatedAt: now }

  if (input.name !== undefined) {
    patch.name = requireTrimmedText(input.name, 'name')
  }
  if (input.address !== undefined) {
    patch.address = requireTrimmedText(input.address, 'address')
  }
  if (input.contactDetails !== undefined) {
    patch.contactDetails = requireTrimmedText(input.contactDetails, 'contactDetails')
  }
  if (input.tradingName !== undefined) {
    patch.tradingName = normalizeOptionalText(input.tradingName)
  }
  if (input.vatRegistered !== undefined) {
    patch.vatRegistered = input.vatRegistered
  }
  if (input.logoAssetPath !== undefined) {
    patch.logoAssetPath =
      input.logoAssetPath === null ? null : validateManagedRelativeLogoPath(input.logoAssetPath)
  }
  if (input.currencyId !== undefined) {
    requireCurrencyExists(db, input.currencyId)
    patch.currencyId = input.currencyId
  }

  db.update(company).set(patch).where(eq(company.id, PRIMARY_COMPANY_ID)).run()

  const updated = getCompany(db)
  if (!updated) {
    throw new CompanyNotFoundError('Company row disappeared during update')
  }
  return updated
}

function toCompany(row: typeof company.$inferSelect): Company {
  return {
    id: row.id,
    name: row.name,
    tradingName: row.tradingName,
    address: row.address,
    contactDetails: row.contactDetails,
    currencyId: row.currencyId,
    vatRegistered: row.vatRegistered,
    logoAssetPath: row.logoAssetPath,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}
