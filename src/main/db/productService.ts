import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { company, PRIMARY_COMPANY_ID, products } from './schema'
import { allocateNext } from './numberingService'
import {
  ProductValidationError,
  requireTrimmedProductName,
  requireValidProductType,
  type ProductType
} from './validation/productValidation'
import { record, type AuditActor } from '../audit/auditService'
import type { AppDb, AppTransaction } from './dbTypes'

export class ProductServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductServiceError'
  }
}

export interface Product {
  id: string
  companyId: string
  code: string
  name: string
  type: ProductType
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateProductInput {
  name: string
  /**
   * Deliberately plain string, not ProductType — matching
   * userManagementService's own CreateAdditionalUserInput.roleCode
   * precedent. requireValidProductType validates and narrows it
   * internally; an out-of-range value fails there with a clear error,
   * not at the type-system boundary.
   */
  type: string
}

/**
 * name only — code is allocated, never supplied, and immutable
 * thereafter (see this module's own doc comment below); type is
 * treated as a structural property fixed at creation, the same
 * conservative posture as code, since letting it change after variants
 * already exist could silently leave a formerly-manufactured product's
 * variants holding a nonzero minimum-stock-level value that a
 * service-type product's variants are never allowed to have. Not
 * explicitly stated as immutable by the approved decisions (only code
 * was), so this is a deliberate, documented interpretive choice, not an
 * oversight — flagged here for visibility.
 */
export interface UpdateProductInput {
  name?: string
}

/**
 * Every function below operates exclusively on the singleton company
 * (PRIMARY_COMPANY_ID) — matching taxCodeService's own pattern exactly.
 * Deactivation, not deletion, is the only way to retire a product: a
 * product may be referenced by variants (which are never cascade-
 * deleted or cascade-deactivated — see productVariantService.ts) and,
 * in later slices, by transactional history.
 *
 * code is never accepted as input anywhere in this file. createProduct
 * allocates it via numberingService.allocateNext('product', ...) inside
 * the same transaction as the insert, using the `product` numbering
 * rule Slice 8's first-run transaction already seeds (prefix PRD,
 * never-reset, 6-digit padding) — infrastructure that existed, unused,
 * before this slice. No update function in this file accepts a code
 * value at all, making an attempt to change it a compile-time
 * impossibility, not merely a runtime-rejected one.
 */

function requireCompanyExists(db: AppDb): void {
  const found = db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.id, PRIMARY_COMPANY_ID))
    .get()
  if (!found) {
    throw new ProductServiceError(
      'Cannot manage products: no company profile exists yet. Complete first-run setup first.'
    )
  }
}

export function listProducts(db: AppDb): Product[] {
  const rows = db.select().from(products).where(eq(products.companyId, PRIMARY_COMPANY_ID)).all()
  return rows.map(toProduct)
}

export function getProductById(db: AppDb, id: string): Product | undefined {
  const row = db
    .select()
    .from(products)
    .where(and(eq(products.companyId, PRIMARY_COMPANY_ID), eq(products.id, id)))
    .get()
  return row ? toProduct(row) : undefined
}

export function createProduct(
  db: AppDb,
  input: CreateProductInput,
  actor: AuditActor,
  now: Date = new Date()
): Product {
  requireCompanyExists(db)

  const name = requireTrimmedProductName(input.name)
  const type = requireValidProductType(input.type)

  const id = `product_${randomUUID()}`

  // Wrapped in its own transaction (nested safely via savepoint if `db`
  // is already a transaction, matching taxCodeService's own verified
  // pattern) so numbering allocation, the insert, and its audit row are
  // all atomic together — a failure anywhere rolls all three back, never
  // leaving an allocated number with no corresponding product row.
  db.transaction((tx) => {
    const code = allocateNext(tx as AppTransaction, 'product', now)

    tx.insert(products)
      .values({
        id,
        companyId: PRIMARY_COMPANY_ID,
        code,
        name,
        type,
        isActive: true,
        createdAt: now,
        updatedAt: now
      })
      .run()

    record(
      tx,
      {
        entityType: 'product',
        entityId: id,
        entityLabel: code,
        action: 'create',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: null,
        after: { code, name, type, isActive: true }
      },
      now
    )
  })

  const created = getProductById(db, id)
  if (!created) {
    throw new ProductServiceError('Product was not persisted after creation')
  }
  return created
}

/**
 * Updates a product's editable fields — currently only name. A no-op
 * update (identical name) writes no audit row, matching
 * taxCodeService's own established no-op-suppression behavior (auditing
 * relies on auditService.record's own before/after diffing to decide
 * this, not a bespoke check here).
 */
export function updateProduct(
  db: AppDb,
  id: string,
  input: UpdateProductInput,
  actor: AuditActor,
  now: Date = new Date()
): Product {
  const existing = getProductById(db, id)
  if (!existing) {
    throw new ProductServiceError(`No product exists with id "${id}"`)
  }

  const name = input.name !== undefined ? requireTrimmedProductName(input.name) : existing.name

  db.transaction((tx) => {
    tx.update(products)
      .set({ name, updatedAt: now })
      .where(and(eq(products.companyId, PRIMARY_COMPANY_ID), eq(products.id, id)))
      .run()

    record(
      tx,
      {
        entityType: 'product',
        entityId: id,
        entityLabel: existing.code,
        action: 'update',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: { name: existing.name },
        after: { name }
      },
      now
    )
  })

  const updated = getProductById(db, id)
  if (!updated) {
    throw new ProductServiceError('Product disappeared during update')
  }
  return updated
}

export function deactivateProduct(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): Product {
  return setActiveState(db, id, false, actor, now)
}

export function reactivateProduct(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): Product {
  return setActiveState(db, id, true, actor, now)
}

/**
 * Changes only this product's own active flag — never cascades to its
 * variants (see productVariantService.ts, which has no code path that
 * reads a parent product's activation state to auto-deactivate its
 * variants). A no-op (already in the requested state) writes no audit
 * row, matching taxCodeService's own established rule.
 */
function setActiveState(
  db: AppDb,
  id: string,
  isActive: boolean,
  actor: AuditActor,
  now: Date
): Product {
  const existing = getProductById(db, id)
  if (!existing) {
    throw new ProductServiceError(`No product exists with id "${id}"`)
  }

  db.transaction((tx) => {
    tx.update(products)
      .set({ isActive, updatedAt: now })
      .where(and(eq(products.companyId, PRIMARY_COMPANY_ID), eq(products.id, id)))
      .run()

    record(
      tx,
      {
        entityType: 'product',
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

  const updated = getProductById(db, id)
  if (!updated) {
    throw new ProductServiceError('Product disappeared during deactivation/reactivation')
  }
  return updated
}

function toProduct(row: typeof products.$inferSelect): Product {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    type: row.type as ProductType,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export { ProductValidationError }
