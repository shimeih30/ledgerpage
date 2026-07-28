import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { company, customers, FUNCTIONAL_CURRENCY_ID, PRIMARY_COMPANY_ID } from './schema'
import {
  normalizeCustomerContactDetails,
  requireNullableCreditLimitMinor,
  requireNullablePaymentTermsDays,
  requireTrimmedCustomerName
} from './validation/customerValidation'
import { allocateNext } from './numberingService'
import { record, type AuditActor } from '../audit/auditService'
import type { AppDb, AppTransaction } from './dbTypes'

export class CustomerServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomerServiceError'
  }
}

export interface Customer {
  id: string
  companyId: string
  code: string
  name: string
  contactDetails: string | null
  paymentTermsDays: number | null
  creditLimitMinor: number | null
  currencyId: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateCustomerInput {
  name: string
  contactDetails?: string | null
  paymentTermsDays?: number | null
  creditLimitMinor?: number | null
}

/**
 * code is deliberately absent from this type -- a structural guarantee
 * (not merely a runtime-rejected one) that no caller can even attempt
 * to change it after creation, mirroring UpdateSupplierInput's own
 * precedent exactly. currencyId is likewise never accepted here at all;
 * it is always FUNCTIONAL_CURRENCY_ID, assigned server-side.
 */
export interface UpdateCustomerInput {
  name?: string
  contactDetails?: string | null
  paymentTermsDays?: number | null
  creditLimitMinor?: number | null
}

function requireCompanyExists(db: AppDb): void {
  const found = db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.id, PRIMARY_COMPANY_ID))
    .get()
  if (!found) {
    throw new CustomerServiceError(
      'Cannot manage customers: no company profile exists yet. Complete first-run setup first.'
    )
  }
}

function toCustomer(row: typeof customers.$inferSelect): Customer {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    contactDetails: row.contactDetails,
    paymentTermsDays: row.paymentTermsDays,
    creditLimitMinor: row.creditLimitMinor,
    currencyId: row.currencyId,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function listCustomers(db: AppDb): Customer[] {
  const rows = db.select().from(customers).where(eq(customers.companyId, PRIMARY_COMPANY_ID)).all()
  return rows.map(toCustomer)
}

export function getCustomerById(db: AppDb, id: string): Customer | undefined {
  const row = db
    .select()
    .from(customers)
    .where(and(eq(customers.companyId, PRIMARY_COMPANY_ID), eq(customers.id, id)))
    .get()
  return row ? toCustomer(row) : undefined
}

/**
 * code is allocated via numberingService.allocateNext('customer', ...)
 * inside the same transaction as the insert and its audit row --
 * numbering allocation, the insert, and the audit write are all atomic
 * together, matching createSupplier's exact pattern. currencyId is
 * always FUNCTIONAL_CURRENCY_ID, never accepted from the caller.
 */
export function createCustomer(
  db: AppDb,
  input: CreateCustomerInput,
  actor: AuditActor,
  now: Date = new Date()
): Customer {
  requireCompanyExists(db)

  const name = requireTrimmedCustomerName(input.name)
  const contactDetails = normalizeCustomerContactDetails(input.contactDetails)
  const paymentTermsDays = requireNullablePaymentTermsDays(input.paymentTermsDays)
  const creditLimitMinor = requireNullableCreditLimitMinor(input.creditLimitMinor)

  const id = `customer_${randomUUID()}`

  db.transaction((tx) => {
    const code = allocateNext(tx as AppTransaction, 'customer', now)

    tx.insert(customers)
      .values({
        id,
        companyId: PRIMARY_COMPANY_ID,
        code,
        name,
        contactDetails,
        paymentTermsDays,
        creditLimitMinor,
        currencyId: FUNCTIONAL_CURRENCY_ID,
        isActive: true,
        createdAt: now,
        updatedAt: now
      })
      .run()

    record(
      tx,
      {
        entityType: 'customer',
        entityId: id,
        entityLabel: code,
        action: 'create',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: null,
        after: {
          code,
          name,
          contactDetails,
          paymentTermsDays,
          creditLimitMinor,
          currencyId: FUNCTIONAL_CURRENCY_ID,
          isActive: true
        }
      },
      now
    )
  })

  const created = getCustomerById(db, id)
  if (!created) {
    throw new CustomerServiceError('Customer was not persisted after creation')
  }
  return created
}

/**
 * A no-op update (every provided field identical to its existing value)
 * writes no audit row, matching the established no-op-suppression
 * convention used by every prior create/update service in this
 * codebase.
 */
export function updateCustomer(
  db: AppDb,
  id: string,
  input: UpdateCustomerInput,
  actor: AuditActor,
  now: Date = new Date()
): Customer {
  const existing = getCustomerById(db, id)
  if (!existing) {
    throw new CustomerServiceError(`No customer exists with id "${id}"`)
  }

  const name = input.name !== undefined ? requireTrimmedCustomerName(input.name) : existing.name
  const contactDetails =
    input.contactDetails !== undefined
      ? normalizeCustomerContactDetails(input.contactDetails)
      : existing.contactDetails
  const paymentTermsDays =
    input.paymentTermsDays !== undefined
      ? requireNullablePaymentTermsDays(input.paymentTermsDays)
      : existing.paymentTermsDays
  const creditLimitMinor =
    input.creditLimitMinor !== undefined
      ? requireNullableCreditLimitMinor(input.creditLimitMinor)
      : existing.creditLimitMinor

  if (
    name === existing.name &&
    contactDetails === existing.contactDetails &&
    paymentTermsDays === existing.paymentTermsDays &&
    creditLimitMinor === existing.creditLimitMinor
  ) {
    return existing
  }

  db.transaction((tx) => {
    tx.update(customers)
      .set({ name, contactDetails, paymentTermsDays, creditLimitMinor, updatedAt: now })
      .where(and(eq(customers.companyId, PRIMARY_COMPANY_ID), eq(customers.id, id)))
      .run()

    record(
      tx,
      {
        entityType: 'customer',
        entityId: id,
        entityLabel: existing.code,
        action: 'update',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: {
          name: existing.name,
          contactDetails: existing.contactDetails,
          paymentTermsDays: existing.paymentTermsDays,
          creditLimitMinor: existing.creditLimitMinor
        },
        after: { name, contactDetails, paymentTermsDays, creditLimitMinor }
      },
      now
    )
  })

  const updated = getCustomerById(db, id)
  if (!updated) {
    throw new CustomerServiceError('Customer disappeared during update')
  }
  return updated
}

export function deactivateCustomer(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): Customer {
  return setActiveState(db, id, false, actor, now)
}

export function reactivateCustomer(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): Customer {
  return setActiveState(db, id, true, actor, now)
}

function setActiveState(
  db: AppDb,
  id: string,
  isActive: boolean,
  actor: AuditActor,
  now: Date
): Customer {
  const existing = getCustomerById(db, id)
  if (!existing) {
    throw new CustomerServiceError(`No customer exists with id "${id}"`)
  }
  if (existing.isActive === isActive) {
    return existing
  }

  db.transaction((tx) => {
    tx.update(customers)
      .set({ isActive, updatedAt: now })
      .where(and(eq(customers.companyId, PRIMARY_COMPANY_ID), eq(customers.id, id)))
      .run()

    record(
      tx,
      {
        entityType: 'customer',
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

  const updated = getCustomerById(db, id)
  if (!updated) {
    throw new CustomerServiceError('Customer disappeared during deactivation/reactivation')
  }
  return updated
}
