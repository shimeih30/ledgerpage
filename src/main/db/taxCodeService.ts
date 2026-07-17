import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import {
  company,
  PRIMARY_COMPANY_ID,
  taxCodes,
  taxRateVersions,
  TAX_CODE_CATEGORIES
} from './schema'
import {
  normalizeTaxCode,
  requireTrimmedTaxName,
  TaxValidationError
} from './validation/taxValidation'
import type { AppDb, AppTransaction } from './dbTypes'

export class TaxConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxConfigurationError'
  }
}

/**
 * Thrown by updateTaxCode when an attempted category change would alter
 * how already-created rate versions are historically resolved (resolution
 * reads the tax code's *current* category — see
 * taxRateResolutionService.ts — so changing category after a version
 * exists would silently rewrite history for every date that version
 * covers). Distinct from TaxConfigurationError so callers can recognize
 * and handle this specific, narrow rule on its own.
 */
export class TaxCategoryImmutableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxCategoryImmutableError'
  }
}

export type TaxCategory = (typeof TAX_CODE_CATEGORIES)[number]

export interface TaxCode {
  id: string
  companyId: string
  code: string
  name: string
  category: TaxCategory
  description: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateTaxCodeInput {
  code: string
  name: string
  category: TaxCategory
  description?: string | null
}

export interface UpdateTaxCodeInput {
  name?: string
  category?: TaxCategory
  description?: string | null
}

/**
 * Every function below operates exclusively on the singleton company
 * (PRIMARY_COMPANY_ID). None of them accept a companyId parameter from
 * any caller — matching companyService's pattern exactly. Deactivation,
 * not deletion, is the only way to retire a code: a tax code may be
 * referenced by historical rate versions and, in later slices, by
 * historical transactions, and deleting it would destroy that history.
 */

function isApprovedCategory(value: string): value is TaxCategory {
  return (TAX_CODE_CATEGORIES as readonly string[]).includes(value)
}

function requireValidCategory(category: string): TaxCategory {
  if (!isApprovedCategory(category)) {
    throw new TaxValidationError(
      `category must be one of ${TAX_CODE_CATEGORIES.join(', ')}; received "${category}"`
    )
  }
  return category
}

function requireCompanyExists(db: AppDb): void {
  const found = db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.id, PRIMARY_COMPANY_ID))
    .get()
  if (!found) {
    throw new TaxConfigurationError(
      'Cannot manage tax codes: no company profile exists yet. Complete first-run setup first.'
    )
  }
}

export function listTaxCodes(db: AppDb): TaxCode[] {
  const rows = db.select().from(taxCodes).where(eq(taxCodes.companyId, PRIMARY_COMPANY_ID)).all()
  return rows.map(toTaxCode)
}

export function getTaxCodeById(db: AppDb, id: string): TaxCode | undefined {
  const row = db
    .select()
    .from(taxCodes)
    .where(and(eq(taxCodes.companyId, PRIMARY_COMPANY_ID), eq(taxCodes.id, id)))
    .get()
  return row ? toTaxCode(row) : undefined
}

/**
 * Looks up a tax code by its normalized code (see normalizeTaxCode) —
 * "vat15", " VAT15 ", and "VAT15" all resolve to the same row.
 */
export function getTaxCodeByCode(db: AppDb, code: string): TaxCode | undefined {
  const normalized = normalizeTaxCode(code)
  const row = db
    .select()
    .from(taxCodes)
    .where(and(eq(taxCodes.companyId, PRIMARY_COMPANY_ID), eq(taxCodes.code, normalized)))
    .get()
  return row ? toTaxCode(row) : undefined
}

export function createTaxCode(
  db: AppDb,
  input: CreateTaxCodeInput,
  now: Date = new Date()
): TaxCode {
  requireCompanyExists(db)

  const normalizedCode = normalizeTaxCode(input.code)
  const name = requireTrimmedTaxName(input.name)
  const category = requireValidCategory(input.category)

  const existing = getTaxCodeByCode(db, normalizedCode)
  if (existing) {
    throw new TaxConfigurationError(
      `A tax code with the normalized code "${normalizedCode}" already exists`
    )
  }

  const id = `tax_code_${randomUUID()}`

  db.insert(taxCodes)
    .values({
      id,
      companyId: PRIMARY_COMPANY_ID,
      code: normalizedCode,
      name,
      category,
      description: input.description ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now
    })
    .run()

  const created = getTaxCodeById(db, id)
  if (!created) {
    throw new TaxConfigurationError('Tax code was not persisted after creation')
  }
  return created
}

/**
 * Updates a tax code's editable fields. Name, description, and
 * activation state are always editable. `category` may only be changed
 * while the tax code has zero tax_rate_versions — once at least one
 * version exists, category is immutable (see TaxCategoryImmutableError).
 * Changing category to its current value is always allowed as a no-op,
 * even after versions exist, since it changes nothing.
 *
 * Requires an active, caller-controlled transaction (AppTransaction, not
 * the broader AppDb) — matching numberingService's and
 * taxRateVersionService's pattern — so the "does a version already
 * exist?" check and the actual update can never diverge. Every call in
 * this codebase wraps this in `db.transaction((tx) => updateTaxCode(tx, ...))`.
 */
export function updateTaxCode(
  tx: AppTransaction,
  id: string,
  input: UpdateTaxCodeInput,
  now: Date = new Date()
): TaxCode {
  const existing = getTaxCodeById(tx, id)
  if (!existing) {
    throw new TaxConfigurationError(`No tax code exists with id "${id}"`)
  }

  const patch: Partial<typeof taxCodes.$inferInsert> = { updatedAt: now }

  if (input.name !== undefined) {
    patch.name = requireTrimmedTaxName(input.name)
  }
  if (input.description !== undefined) {
    patch.description = input.description
  }
  if (input.category !== undefined) {
    const nextCategory = requireValidCategory(input.category)
    if (nextCategory !== existing.category) {
      const versionCount = tx
        .select({ id: taxRateVersions.id })
        .from(taxRateVersions)
        .where(eq(taxRateVersions.taxCodeId, id))
        .all().length

      if (versionCount > 0) {
        throw new TaxCategoryImmutableError(
          `Cannot change category for tax code "${id}" from "${existing.category}" to ` +
            `"${nextCategory}": ${versionCount} rate version(s) already exist. Category becomes ` +
            'immutable once the first rate version has been created, since resolution reads the ' +
            'current category and this would silently change already-resolved history.'
        )
      }
    }
    patch.category = nextCategory
  }

  tx.update(taxCodes)
    .set(patch)
    .where(and(eq(taxCodes.companyId, PRIMARY_COMPANY_ID), eq(taxCodes.id, id)))
    .run()

  const updated = getTaxCodeById(tx, id)
  if (!updated) {
    throw new TaxConfigurationError('Tax code disappeared during update')
  }
  return updated
}

export function deactivateTaxCode(db: AppDb, id: string, now: Date = new Date()): TaxCode {
  return setActiveState(db, id, false, now)
}

export function reactivateTaxCode(db: AppDb, id: string, now: Date = new Date()): TaxCode {
  return setActiveState(db, id, true, now)
}

function setActiveState(db: AppDb, id: string, isActive: boolean, now: Date): TaxCode {
  const existing = getTaxCodeById(db, id)
  if (!existing) {
    throw new TaxConfigurationError(`No tax code exists with id "${id}"`)
  }

  db.update(taxCodes)
    .set({ isActive, updatedAt: now })
    .where(and(eq(taxCodes.companyId, PRIMARY_COMPANY_ID), eq(taxCodes.id, id)))
    .run()

  const updated = getTaxCodeById(db, id)
  if (!updated) {
    throw new TaxConfigurationError('Tax code disappeared during deactivation/reactivation')
  }
  return updated
}

function toTaxCode(row: typeof taxCodes.$inferSelect): TaxCode {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    category: row.category as TaxCategory,
    description: row.description,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}
