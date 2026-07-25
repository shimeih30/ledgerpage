import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { company, suppliers, PRIMARY_COMPANY_ID } from './schema'
import {
  normalizeSupplierContactDetails,
  requireTrimmedSupplierName
} from './validation/supplierValidation'
import { allocateNext } from './numberingService'
import { record, type AuditActor } from '../audit/auditService'
import type { AppDb, AppTransaction } from './dbTypes'

export class SupplierServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupplierServiceError'
  }
}

export interface Supplier {
  id: string
  companyId: string
  code: string
  name: string
  contactDetails: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateSupplierInput {
  name: string
  contactDetails?: string | null
}

/**
 * code is deliberately absent from this type -- a structural guarantee
 * (not merely a runtime-rejected one) that no caller can even attempt
 * to change it after creation, mirroring UpdateProductInput's own
 * precedent exactly.
 */
export interface UpdateSupplierInput {
  name?: string
  contactDetails?: string | null
}

function requireCompanyExists(db: AppDb): void {
  const found = db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.id, PRIMARY_COMPANY_ID))
    .get()
  if (!found) {
    throw new SupplierServiceError(
      'Cannot manage suppliers: no company profile exists yet. Complete first-run setup first.'
    )
  }
}

function toSupplier(row: typeof suppliers.$inferSelect): Supplier {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    contactDetails: row.contactDetails,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function listSuppliers(db: AppDb): Supplier[] {
  const rows = db.select().from(suppliers).where(eq(suppliers.companyId, PRIMARY_COMPANY_ID)).all()
  return rows.map(toSupplier)
}

export function getSupplierById(db: AppDb, id: string): Supplier | undefined {
  const row = db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.companyId, PRIMARY_COMPANY_ID), eq(suppliers.id, id)))
    .get()
  return row ? toSupplier(row) : undefined
}

/**
 * code is allocated via numberingService.allocateNext('supplier', ...)
 * inside the same transaction as the insert and its audit row --
 * numbering allocation, the insert, and the audit write are all atomic
 * together, matching createProduct's exact pattern. A failure anywhere
 * rolls all three back, never leaving an allocated number with no
 * corresponding supplier row.
 */
export function createSupplier(
  db: AppDb,
  input: CreateSupplierInput,
  actor: AuditActor,
  now: Date = new Date()
): Supplier {
  requireCompanyExists(db)

  const name = requireTrimmedSupplierName(input.name)
  const contactDetails = normalizeSupplierContactDetails(input.contactDetails)

  const id = `supplier_${randomUUID()}`

  db.transaction((tx) => {
    const code = allocateNext(tx as AppTransaction, 'supplier', now)

    tx.insert(suppliers)
      .values({
        id,
        companyId: PRIMARY_COMPANY_ID,
        code,
        name,
        contactDetails,
        isActive: true,
        createdAt: now,
        updatedAt: now
      })
      .run()

    record(
      tx,
      {
        entityType: 'supplier',
        entityId: id,
        entityLabel: code,
        action: 'create',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: null,
        after: { code, name, contactDetails, isActive: true }
      },
      now
    )
  })

  const created = getSupplierById(db, id)
  if (!created) {
    throw new SupplierServiceError('Supplier was not persisted after creation')
  }
  return created
}

/**
 * A no-op update (every provided field identical to its existing value)
 * writes no audit row, matching the established no-op-suppression
 * convention used by every prior create/update service in this codebase.
 */
export function updateSupplier(
  db: AppDb,
  id: string,
  input: UpdateSupplierInput,
  actor: AuditActor,
  now: Date = new Date()
): Supplier {
  const existing = getSupplierById(db, id)
  if (!existing) {
    throw new SupplierServiceError(`No supplier exists with id "${id}"`)
  }

  const name = input.name !== undefined ? requireTrimmedSupplierName(input.name) : existing.name
  const contactDetails =
    input.contactDetails !== undefined
      ? normalizeSupplierContactDetails(input.contactDetails)
      : existing.contactDetails

  if (name === existing.name && contactDetails === existing.contactDetails) {
    return existing
  }

  db.transaction((tx) => {
    tx.update(suppliers)
      .set({ name, contactDetails, updatedAt: now })
      .where(and(eq(suppliers.companyId, PRIMARY_COMPANY_ID), eq(suppliers.id, id)))
      .run()

    record(
      tx,
      {
        entityType: 'supplier',
        entityId: id,
        entityLabel: existing.code,
        action: 'update',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: { name: existing.name, contactDetails: existing.contactDetails },
        after: { name, contactDetails }
      },
      now
    )
  })

  const updated = getSupplierById(db, id)
  if (!updated) {
    throw new SupplierServiceError('Supplier disappeared during update')
  }
  return updated
}

export function deactivateSupplier(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): Supplier {
  return setActiveState(db, id, false, actor, now)
}

export function reactivateSupplier(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): Supplier {
  return setActiveState(db, id, true, actor, now)
}

function setActiveState(
  db: AppDb,
  id: string,
  isActive: boolean,
  actor: AuditActor,
  now: Date
): Supplier {
  const existing = getSupplierById(db, id)
  if (!existing) {
    throw new SupplierServiceError(`No supplier exists with id "${id}"`)
  }
  if (existing.isActive === isActive) {
    return existing
  }

  db.transaction((tx) => {
    tx.update(suppliers)
      .set({ isActive, updatedAt: now })
      .where(and(eq(suppliers.companyId, PRIMARY_COMPANY_ID), eq(suppliers.id, id)))
      .run()

    record(
      tx,
      {
        entityType: 'supplier',
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

  const updated = getSupplierById(db, id)
  if (!updated) {
    throw new SupplierServiceError('Supplier disappeared during deactivation/reactivation')
  }
  return updated
}
