import { randomUUID } from 'node:crypto'
import { and, eq, ne } from 'drizzle-orm'
import { FUNCTIONAL_CURRENCY_ID, PRIMARY_COMPANY_ID, productVariants, taxCodes } from './schema'
import { getProductById } from './productService'
import { getTaxCodeById } from './taxCodeService'
import {
  normalizeBarcode,
  normalizeVariantCode,
  ProductValidationError,
  requireNonNegativeIntegerMinorAmount,
  requireNonNegativeIntegerStockLevel,
  requireTrimmedVariantName,
  type ProductType
} from './validation/productValidation'
import { record, type AuditActor } from '../audit/auditService'
import type { AppDb } from './dbTypes'

export class ProductVariantServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductVariantServiceError'
  }
}

/**
 * Distinct from the generic ProductValidationError specifically so the
 * IPC handler layer can map it to a specific, actionable errorCode
 * ('duplicate_code') via instanceof, never by inspecting an error
 * message string.
 */
export class DuplicateVariantCodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateVariantCodeError'
  }
}

/** Same reasoning as DuplicateVariantCodeError, for 'duplicate_barcode'. */
export class DuplicateBarcodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateBarcodeError'
  }
}

export interface ProductVariant {
  id: string
  productId: string
  code: string
  name: string
  sellingPriceMinor: number
  currencyId: string
  taxCodeId: string | null
  /**
   * The referenced tax code's own code (e.g. "STD"), resolved fresh via
   * a join on every read — regardless of whether that tax code is
   * currently active. This is what lets the edit form display "this
   * variant currently references STD" even after STD has since been
   * deactivated, without ever offering STD as a new assignable choice
   * (listAssignableTaxCodes, a separate read path, stays active-only).
   * null whenever taxCodeId itself is null.
   */
  taxCodeLabel: string | null
  barcode: string | null
  minimumFinishedStockLevel: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateVariantInput {
  productId: string
  code: string
  name: string
  sellingPriceMinor: number
  taxCodeId?: string | null
  barcode?: string | null
  /** Omitted or 0 is always valid; a nonzero value is rejected for a service-type product's variant. */
  minimumFinishedStockLevel?: number
}

/**
 * code is included here (unlike products.code) because a variant code
 * is ordinary user-entered input, not an allocated number — no
 * numbering rule exists for variants, and nothing in the approved
 * decisions states it is immutable, unlike products.code. Editable here
 * with the same product-scoped uniqueness re-checked on every update
 * (excluding the row being updated), so correcting a typo doesn't
 * require deleting and recreating the variant. productId is
 * deliberately absent — a variant is never reparented to a different
 * product through this function.
 */
export interface UpdateVariantInput {
  code?: string
  name?: string
  sellingPriceMinor?: number
  taxCodeId?: string | null
  barcode?: string | null
  minimumFinishedStockLevel?: number
}

/**
 * currency_id is never accepted as input anywhere in this file — every
 * row is written with FUNCTIONAL_CURRENCY_ID (see schema.ts's own doc
 * comment on product_variants), mirroring company.currency_id's "no
 * code path lets a caller choose a different functional currency"
 * posture. tax_code_id, when supplied, must reference an existing,
 * primary-company, currently-active tax code (requireValidTaxCodeRef
 * below) — but once stored, a later deactivation of that tax code never
 * clears or cascades onto this reference; only assignment of a *new*
 * reference is gated on the tax code being active right now.
 *
 * Deactivation, not deletion, is the only way to retire a variant.
 * Deactivating or reactivating a variant changes only that one variant
 * — no code path here reads or writes anything on the parent product.
 */

function requireProduct(db: AppDb, productId: string): { id: string; type: ProductType } {
  const productRow = getProductById(db, productId)
  if (!productRow) {
    throw new ProductVariantServiceError(`No product exists with id "${productId}"`)
  }
  return productRow
}

function requireValidTaxCodeRef(db: AppDb, taxCodeId: string | null | undefined): string | null {
  if (taxCodeId === null || taxCodeId === undefined) {
    return null
  }
  // getTaxCodeById is already scoped to the primary company, so "must
  // exist" and "must belong to the primary company" are one check.
  const taxCode = getTaxCodeById(db, taxCodeId)
  if (!taxCode) {
    throw new ProductValidationError(`No tax code exists with id "${taxCodeId}"`)
  }
  if (!taxCode.isActive) {
    throw new ProductValidationError(
      `Tax code "${taxCode.code}" is not active and cannot be assigned to a variant`
    )
  }
  return taxCodeId
}

/**
 * Omitted or explicit 0 is always valid, for either product type.
 * Anything else is rejected outright for a service-type product's
 * variant — never silently coerced to 0 — and otherwise (a
 * manufactured-type product) validated as a plain non-negative integer.
 */
function resolveMinimumFinishedStockLevel(
  productType: ProductType,
  requestedValue: number | undefined
): number {
  const value = requestedValue ?? 0
  const validated = requireNonNegativeIntegerStockLevel(value, 'minimumFinishedStockLevel')
  if (productType === 'service' && validated !== 0) {
    throw new ProductValidationError(
      "minimumFinishedStockLevel must be 0 for a service-type product's variant"
    )
  }
  return validated
}

function requireUniqueCodeWithinProduct(
  db: AppDb,
  productId: string,
  normalizedCode: string,
  excludeVariantId?: string
): void {
  const conditions = [
    eq(productVariants.productId, productId),
    eq(productVariants.code, normalizedCode)
  ]
  if (excludeVariantId) {
    conditions.push(ne(productVariants.id, excludeVariantId))
  }
  const existing = db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(and(...conditions))
    .get()
  if (existing) {
    throw new DuplicateVariantCodeError(
      `A variant with the normalized code "${normalizedCode}" already exists for this product`
    )
  }
}

/**
 * Checked explicitly at the service layer — not left to surface as a
 * raw SQLite constraint-violation error from the partial unique index
 * (product_variants_barcode_unique) — so a duplicate barcode always
 * fails cleanly with a named, catchable error, the same posture as the
 * code-uniqueness check above. `barcode` is already normalized (trimmed,
 * empty-to-null) by the caller before this runs, so a null value here
 * always means "no barcode," never skipped.
 */
function requireUniqueBarcode(db: AppDb, barcode: string | null, excludeVariantId?: string): void {
  if (barcode === null) {
    return
  }
  const conditions = [eq(productVariants.barcode, barcode)]
  if (excludeVariantId) {
    conditions.push(ne(productVariants.id, excludeVariantId))
  }
  const existing = db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(and(...conditions))
    .get()
  if (existing) {
    throw new DuplicateBarcodeError(`A variant with the barcode "${barcode}" already exists`)
  }
}

interface JoinedVariantRow {
  id: string
  productId: string
  code: string
  name: string
  sellingPriceMinor: number
  currencyId: string
  taxCodeId: string | null
  barcode: string | null
  minimumFinishedStockLevel: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  taxCodeLabel: string | null
}

const VARIANT_JOIN_COLUMNS = {
  id: productVariants.id,
  productId: productVariants.productId,
  code: productVariants.code,
  name: productVariants.name,
  sellingPriceMinor: productVariants.sellingPriceMinor,
  currencyId: productVariants.currencyId,
  taxCodeId: productVariants.taxCodeId,
  barcode: productVariants.barcode,
  minimumFinishedStockLevel: productVariants.minimumFinishedStockLevel,
  isActive: productVariants.isActive,
  createdAt: productVariants.createdAt,
  updatedAt: productVariants.updatedAt,
  taxCodeLabel: taxCodes.code
}

export function listVariantsForProduct(db: AppDb, productId: string): ProductVariant[] {
  const rows = db
    .select(VARIANT_JOIN_COLUMNS)
    .from(productVariants)
    .leftJoin(taxCodes, eq(productVariants.taxCodeId, taxCodes.id))
    .where(eq(productVariants.productId, productId))
    .all()
  return rows.map(toProductVariant)
}

export function getVariantById(db: AppDb, id: string): ProductVariant | undefined {
  const row = db
    .select(VARIANT_JOIN_COLUMNS)
    .from(productVariants)
    .leftJoin(taxCodes, eq(productVariants.taxCodeId, taxCodes.id))
    .where(eq(productVariants.id, id))
    .get()
  return row ? toProductVariant(row) : undefined
}

export function createVariant(
  db: AppDb,
  input: CreateVariantInput,
  actor: AuditActor,
  now: Date = new Date()
): ProductVariant {
  const product = requireProduct(db, input.productId)
  const code = normalizeVariantCode(input.code)
  const name = requireTrimmedVariantName(input.name)
  const sellingPriceMinor = requireNonNegativeIntegerMinorAmount(
    input.sellingPriceMinor,
    'sellingPriceMinor'
  )
  const taxCodeId = requireValidTaxCodeRef(db, input.taxCodeId)
  const barcode = normalizeBarcode(input.barcode)
  const minimumFinishedStockLevel = resolveMinimumFinishedStockLevel(
    product.type,
    input.minimumFinishedStockLevel
  )

  requireUniqueCodeWithinProduct(db, input.productId, code)
  requireUniqueBarcode(db, barcode)

  const id = `product_variant_${randomUUID()}`

  db.transaction((tx) => {
    tx.insert(productVariants)
      .values({
        id,
        productId: input.productId,
        code,
        name,
        sellingPriceMinor,
        currencyId: FUNCTIONAL_CURRENCY_ID,
        taxCodeId,
        barcode,
        minimumFinishedStockLevel,
        isActive: true,
        createdAt: now,
        updatedAt: now
      })
      .run()

    record(
      tx,
      {
        entityType: 'product_variant',
        entityId: id,
        entityLabel: code,
        action: 'create',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: null,
        after: {
          productId: input.productId,
          code,
          name,
          sellingPriceMinor,
          currencyId: FUNCTIONAL_CURRENCY_ID,
          taxCodeId,
          barcode,
          minimumFinishedStockLevel,
          isActive: true
        }
      },
      now
    )
  })

  const created = getVariantById(db, id)
  if (!created) {
    throw new ProductVariantServiceError('Variant was not persisted after creation')
  }
  return created
}

export function updateVariant(
  db: AppDb,
  id: string,
  input: UpdateVariantInput,
  actor: AuditActor,
  now: Date = new Date()
): ProductVariant {
  const existing = getVariantById(db, id)
  if (!existing) {
    throw new ProductVariantServiceError(`No product variant exists with id "${id}"`)
  }
  const product = requireProduct(db, existing.productId)

  const code = input.code !== undefined ? normalizeVariantCode(input.code) : existing.code
  const name = input.name !== undefined ? requireTrimmedVariantName(input.name) : existing.name
  const sellingPriceMinor =
    input.sellingPriceMinor !== undefined
      ? requireNonNegativeIntegerMinorAmount(input.sellingPriceMinor, 'sellingPriceMinor')
      : existing.sellingPriceMinor
  const taxCodeId =
    input.taxCodeId !== undefined ? requireValidTaxCodeRef(db, input.taxCodeId) : existing.taxCodeId
  const barcode = input.barcode !== undefined ? normalizeBarcode(input.barcode) : existing.barcode
  const minimumFinishedStockLevel =
    input.minimumFinishedStockLevel !== undefined
      ? resolveMinimumFinishedStockLevel(product.type, input.minimumFinishedStockLevel)
      : existing.minimumFinishedStockLevel

  if (code !== existing.code) {
    requireUniqueCodeWithinProduct(db, existing.productId, code, id)
  }
  if (barcode !== existing.barcode) {
    requireUniqueBarcode(db, barcode, id)
  }

  db.transaction((tx) => {
    tx.update(productVariants)
      .set({
        code,
        name,
        sellingPriceMinor,
        taxCodeId,
        barcode,
        minimumFinishedStockLevel,
        updatedAt: now
      })
      .where(eq(productVariants.id, id))
      .run()

    record(
      tx,
      {
        entityType: 'product_variant',
        entityId: id,
        entityLabel: existing.code,
        action: 'update',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: {
          code: existing.code,
          name: existing.name,
          sellingPriceMinor: existing.sellingPriceMinor,
          taxCodeId: existing.taxCodeId,
          barcode: existing.barcode,
          minimumFinishedStockLevel: existing.minimumFinishedStockLevel
        },
        after: { code, name, sellingPriceMinor, taxCodeId, barcode, minimumFinishedStockLevel }
      },
      now
    )
  })

  const updated = getVariantById(db, id)
  if (!updated) {
    throw new ProductVariantServiceError('Variant disappeared during update')
  }
  return updated
}

export function deactivateVariant(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): ProductVariant {
  return setActiveState(db, id, false, actor, now)
}

export function reactivateVariant(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): ProductVariant {
  return setActiveState(db, id, true, actor, now)
}

function setActiveState(
  db: AppDb,
  id: string,
  isActive: boolean,
  actor: AuditActor,
  now: Date
): ProductVariant {
  const existing = getVariantById(db, id)
  if (!existing) {
    throw new ProductVariantServiceError(`No product variant exists with id "${id}"`)
  }

  db.transaction((tx) => {
    tx.update(productVariants)
      .set({ isActive, updatedAt: now })
      .where(eq(productVariants.id, id))
      .run()

    record(
      tx,
      {
        entityType: 'product_variant',
        entityId: id,
        entityLabel: existing.code,
        action: isActive ? 'reactivate' : 'deactivate',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: { isActive: existing.isActive },
        after: { isActive }
      },
      now
    )
  })

  const updated = getVariantById(db, id)
  if (!updated) {
    throw new ProductVariantServiceError('Variant disappeared during deactivation/reactivation')
  }
  return updated
}

function toProductVariant(row: JoinedVariantRow): ProductVariant {
  return {
    id: row.id,
    productId: row.productId,
    code: row.code,
    name: row.name,
    sellingPriceMinor: row.sellingPriceMinor,
    currencyId: row.currencyId,
    taxCodeId: row.taxCodeId,
    taxCodeLabel: row.taxCodeLabel,
    barcode: row.barcode,
    minimumFinishedStockLevel: row.minimumFinishedStockLevel,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}
