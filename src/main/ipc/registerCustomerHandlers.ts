import { ipcMain } from 'electron'
import {
  CUSTOMER_CONTACTS_CREATE_CHANNEL,
  CUSTOMER_CONTACTS_DEACTIVATE_CHANNEL,
  CUSTOMER_CONTACTS_GET_CHANNEL,
  CUSTOMER_CONTACTS_LIST_CHANNEL,
  CUSTOMER_CONTACTS_REACTIVATE_CHANNEL,
  CUSTOMER_CONTACTS_UPDATE_CHANNEL,
  CUSTOMERS_CREATE_CHANNEL,
  CUSTOMERS_DEACTIVATE_CHANNEL,
  CUSTOMERS_GET_CHANNEL,
  CUSTOMERS_LIST_CHANNEL,
  CUSTOMERS_REACTIVATE_CHANNEL,
  CUSTOMERS_UPDATE_CHANNEL,
  type CreateCustomerContactResult,
  type CreateCustomerResult,
  type CustomerContactIdInput,
  type CustomerIdInput,
  type CustomersErrorCode,
  type GetCustomerContactResult,
  type GetCustomerResult,
  type ListCustomerContactsResult,
  type ListCustomersResult,
  type MutateCustomerContactResult,
  type MutateCustomerResult,
  type SafeCustomer,
  type SafeCustomerContact,
  type UpdateCustomerContactResult,
  type UpdateCustomerResult
} from '../../shared/ipc/customers'
import type { NavigationPolicyContext } from '../security/navigationPolicy'
import { isApprovedIpcSender, type ApprovableIpcEvent } from '../security/senderValidation'
import { requireAuthorizedCaller } from '../auth/requireAuthorizedCaller'
import type { LoginService } from '../users/loginService'
import {
  createCustomer,
  deactivateCustomer,
  getCustomerById,
  listCustomers,
  reactivateCustomer,
  CustomerServiceError,
  updateCustomer,
  type Customer
} from '../db/customerService'
import {
  createCustomerContact,
  deactivateCustomerContact,
  getCustomerContactById,
  listContactsForCustomer,
  reactivateCustomerContact,
  CustomerContactServiceError,
  updateCustomerContact,
  type CustomerContact
} from '../db/customerContactService'
import { CustomerValidationError } from '../db/validation/customerValidation'
import { CustomerContactValidationError } from '../db/validation/customerContactValidation'
import type { AppDb } from '../db/dbTypes'

class CustomersIpcInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomersIpcInputError'
  }
}

function requireApprovedSender(event: ApprovableIpcEvent, context: NavigationPolicyContext): void {
  if (!isApprovedIpcSender(event, context)) {
    throw new Error('LedgerPage: rejected customers request from an unapproved sender')
  }
}

function requireStringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new CustomersIpcInputError(`${fieldName} must be a string`)
  }
  return value
}

function requireOptionalStringField(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  return requireStringField(value, fieldName)
}

function requireNullableOptionalStringField(
  value: unknown,
  fieldName: string
): string | null | undefined {
  if (value === undefined || value === null) {
    return value
  }
  return requireStringField(value, fieldName)
}

function requireNullableOptionalNumberField(
  value: unknown,
  fieldName: string
): number | null | undefined {
  if (value === undefined || value === null) {
    return value
  }
  if (typeof value !== 'number') {
    throw new CustomersIpcInputError(`${fieldName} must be a number`)
  }
  return value
}

function parseCustomerIdInput(input: unknown): CustomerIdInput {
  if (typeof input !== 'object' || input === null) {
    throw new CustomersIpcInputError('input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return { customerId: requireStringField(candidate.customerId, 'customerId') }
}

function parseCustomerContactIdInput(input: unknown): CustomerContactIdInput {
  if (typeof input !== 'object' || input === null) {
    throw new CustomersIpcInputError('input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return { contactId: requireStringField(candidate.contactId, 'contactId') }
}

interface ParsedCreateCustomerInput {
  name: string
  contactDetails?: string | null
  paymentTermsDays?: number | null
  creditLimitMinor?: number | null
}

/**
 * Shape-only parsing — only the fields CreateCustomerInput actually
 * declares are ever read off the raw payload. An injected code,
 * currencyId, actor, sessionId, companyId, isActive, or timestamp field
 * is silently never looked at, structurally as much as behaviorally:
 * there is no code path here that would forward it anywhere.
 */
function parseCreateCustomerInput(input: unknown): ParsedCreateCustomerInput {
  if (typeof input !== 'object' || input === null) {
    throw new CustomersIpcInputError('createCustomer input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    name: requireStringField(candidate.name, 'name'),
    contactDetails: requireNullableOptionalStringField(candidate.contactDetails, 'contactDetails'),
    paymentTermsDays: requireNullableOptionalNumberField(
      candidate.paymentTermsDays,
      'paymentTermsDays'
    ),
    creditLimitMinor: requireNullableOptionalNumberField(
      candidate.creditLimitMinor,
      'creditLimitMinor'
    )
  }
}

interface ParsedUpdateCustomerInput {
  customerId: string
  name?: string
  contactDetails?: string | null
  paymentTermsDays?: number | null
  creditLimitMinor?: number | null
}

/**
 * code and currencyId are never read off the raw payload here — not
 * merely omitted from the result, but never even inspected.
 */
function parseUpdateCustomerInput(input: unknown): ParsedUpdateCustomerInput {
  if (typeof input !== 'object' || input === null) {
    throw new CustomersIpcInputError('updateCustomer input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    customerId: requireStringField(candidate.customerId, 'customerId'),
    name: requireOptionalStringField(candidate.name, 'name'),
    contactDetails: requireNullableOptionalStringField(candidate.contactDetails, 'contactDetails'),
    paymentTermsDays: requireNullableOptionalNumberField(
      candidate.paymentTermsDays,
      'paymentTermsDays'
    ),
    creditLimitMinor: requireNullableOptionalNumberField(
      candidate.creditLimitMinor,
      'creditLimitMinor'
    )
  }
}

interface ParsedCreateCustomerContactInput {
  customerId: string
  name: string
  role?: string | null
  phone?: string | null
  email?: string | null
}

/**
 * customerId comes only from the explicit, trusted handler input here —
 * this is the one and only place a contact's parent is established.
 */
function parseCreateCustomerContactInput(input: unknown): ParsedCreateCustomerContactInput {
  if (typeof input !== 'object' || input === null) {
    throw new CustomersIpcInputError('createCustomerContact input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    customerId: requireStringField(candidate.customerId, 'customerId'),
    name: requireStringField(candidate.name, 'name'),
    role: requireNullableOptionalStringField(candidate.role, 'role'),
    phone: requireNullableOptionalStringField(candidate.phone, 'phone'),
    email: requireNullableOptionalStringField(candidate.email, 'email')
  }
}

interface ParsedUpdateCustomerContactInput {
  contactId: string
  name?: string
  role?: string | null
  phone?: string | null
  email?: string | null
}

/**
 * customerId is never read off the raw payload here — not merely
 * omitted from the result, but never even inspected. An injected
 * `customerId` on the raw update payload has no effect whatsoever: a
 * contact's parent is fixed at creation and never reassigned via
 * update.
 */
function parseUpdateCustomerContactInput(input: unknown): ParsedUpdateCustomerContactInput {
  if (typeof input !== 'object' || input === null) {
    throw new CustomersIpcInputError('updateCustomerContact input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    contactId: requireStringField(candidate.contactId, 'contactId'),
    name: requireOptionalStringField(candidate.name, 'name'),
    role: requireNullableOptionalStringField(candidate.role, 'role'),
    phone: requireNullableOptionalStringField(candidate.phone, 'phone'),
    email: requireNullableOptionalStringField(candidate.email, 'email')
  }
}

function toSafeCustomer(customer: Customer): SafeCustomer {
  return {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    contactDetails: customer.contactDetails,
    paymentTermsDays: customer.paymentTermsDays,
    creditLimitMinor: customer.creditLimitMinor,
    currencyId: customer.currencyId,
    isActive: customer.isActive,
    createdAt: customer.createdAt.getTime(),
    updatedAt: customer.updatedAt.getTime()
  }
}

function toSafeCustomerContact(contact: CustomerContact): SafeCustomerContact {
  return {
    id: contact.id,
    customerId: contact.customerId,
    name: contact.name,
    role: contact.role,
    phone: contact.phone,
    email: contact.email,
    isActive: contact.isActive,
    createdAt: contact.createdAt.getTime(),
    updatedAt: contact.updatedAt.getTime()
  }
}

/**
 * Maps a thrown service-layer error to a safe, fixed errorCode — never
 * forwarding the error's own message to the renderer. instanceof checks
 * against named error classes, never string-matching against a
 * message.
 */
function toErrorCode(error: unknown): CustomersErrorCode {
  if (error instanceof CustomerValidationError || error instanceof CustomerContactValidationError) {
    return 'invalid_input'
  }
  if (error instanceof CustomerContactServiceError) {
    // Both "no customer exists" and "customer is not active" map to
    // invalid_input here — deliberately not not_found, since an
    // inactive-but-existing parent is a validation failure on the
    // request (mutating a contact under it is what's invalid), not a
    // missing-resource failure.
    return 'invalid_input'
  }
  if (error instanceof CustomerServiceError && /^No customer exists with id/.test(error.message)) {
    return 'not_found'
  }
  return 'unexpected_error'
}

export interface RegisterCustomerHandlersOptions {
  context: NavigationPolicyContext
  db: AppDb
  loginService: LoginService
}

/**
 * Registers every Slice 14 customers and customer-contacts IPC
 * handler. Every handler is gated by requireAuthorizedCaller, resolved
 * fresh from SQLite on every call — never a renderer-supplied
 * canViewCustomers/canManageCustomers flag. Reads require
 * customers.read; all mutations (customer AND contact) require
 * customers.manage — there is no separate action for contact
 * management, mirroring how supplier_item_prices reuses
 * suppliers.read/suppliers.manage directly.
 *
 * No update/delete channel exists for hard-deleting a contact —
 * customer_contacts uses soft activation only.
 */
export function registerCustomerHandlers(options: RegisterCustomerHandlersOptions): void {
  const { context, db, loginService } = options

  ipcMain.handle(CUSTOMERS_LIST_CHANNEL, (event): ListCustomersResult => {
    requireApprovedSender(event, context)

    const authResult = requireAuthorizedCaller(db, loginService, 'customers.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      return { success: true, customers: listCustomers(db).map(toSafeCustomer) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(CUSTOMERS_GET_CHANNEL, (event, rawInput: unknown): GetCustomerResult => {
    requireApprovedSender(event, context)

    let input: CustomerIdInput
    try {
      input = parseCustomerIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'customers.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    const customer = getCustomerById(db, input.customerId)
    if (!customer) {
      return { success: false, errorCode: 'not_found' }
    }
    return { success: true, customer: toSafeCustomer(customer) }
  })

  ipcMain.handle(CUSTOMERS_CREATE_CHANNEL, (event, rawInput: unknown): CreateCustomerResult => {
    requireApprovedSender(event, context)

    let input: ParsedCreateCustomerInput
    try {
      input = parseCreateCustomerInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'customers.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const customer = createCustomer(db, input, {
        type: 'user',
        userId: authResult.callerUserId
      })
      return { success: true, customer: toSafeCustomer(customer) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(CUSTOMERS_UPDATE_CHANNEL, (event, rawInput: unknown): UpdateCustomerResult => {
    requireApprovedSender(event, context)

    let input: ParsedUpdateCustomerInput
    try {
      input = parseUpdateCustomerInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'customers.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const customer = updateCustomer(
        db,
        input.customerId,
        {
          name: input.name,
          contactDetails: input.contactDetails,
          paymentTermsDays: input.paymentTermsDays,
          creditLimitMinor: input.creditLimitMinor
        },
        { type: 'user', userId: authResult.callerUserId }
      )
      return { success: true, customer: toSafeCustomer(customer) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(CUSTOMERS_DEACTIVATE_CHANNEL, (event, rawInput: unknown): MutateCustomerResult => {
    requireApprovedSender(event, context)

    let input: CustomerIdInput
    try {
      input = parseCustomerIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'customers.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const customer = deactivateCustomer(db, input.customerId, {
        type: 'user',
        userId: authResult.callerUserId
      })
      return { success: true, customer: toSafeCustomer(customer) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(CUSTOMERS_REACTIVATE_CHANNEL, (event, rawInput: unknown): MutateCustomerResult => {
    requireApprovedSender(event, context)

    let input: CustomerIdInput
    try {
      input = parseCustomerIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'customers.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const customer = reactivateCustomer(db, input.customerId, {
        type: 'user',
        userId: authResult.callerUserId
      })
      return { success: true, customer: toSafeCustomer(customer) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(
    CUSTOMER_CONTACTS_LIST_CHANNEL,
    (event, rawInput: unknown): ListCustomerContactsResult => {
      requireApprovedSender(event, context)

      let input: CustomerIdInput
      try {
        input = parseCustomerIdInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'customers.read')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        return {
          success: true,
          contacts: listContactsForCustomer(db, input.customerId).map(toSafeCustomerContact)
        }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    CUSTOMER_CONTACTS_GET_CHANNEL,
    (event, rawInput: unknown): GetCustomerContactResult => {
      requireApprovedSender(event, context)

      let input: CustomerContactIdInput
      try {
        input = parseCustomerContactIdInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'customers.read')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      const contact = getCustomerContactById(db, input.contactId)
      if (!contact) {
        return { success: false, errorCode: 'not_found' }
      }
      return { success: true, contact: toSafeCustomerContact(contact) }
    }
  )

  ipcMain.handle(
    CUSTOMER_CONTACTS_CREATE_CHANNEL,
    (event, rawInput: unknown): CreateCustomerContactResult => {
      requireApprovedSender(event, context)

      let input: ParsedCreateCustomerContactInput
      try {
        input = parseCreateCustomerContactInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'customers.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const contact = createCustomerContact(db, input, {
          type: 'user',
          userId: authResult.callerUserId
        })
        return { success: true, contact: toSafeCustomerContact(contact) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    CUSTOMER_CONTACTS_UPDATE_CHANNEL,
    (event, rawInput: unknown): UpdateCustomerContactResult => {
      requireApprovedSender(event, context)

      let input: ParsedUpdateCustomerContactInput
      try {
        input = parseUpdateCustomerContactInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'customers.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const contact = updateCustomerContact(
          db,
          input.contactId,
          { name: input.name, role: input.role, phone: input.phone, email: input.email },
          { type: 'user', userId: authResult.callerUserId }
        )
        return { success: true, contact: toSafeCustomerContact(contact) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    CUSTOMER_CONTACTS_DEACTIVATE_CHANNEL,
    (event, rawInput: unknown): MutateCustomerContactResult => {
      requireApprovedSender(event, context)

      let input: CustomerContactIdInput
      try {
        input = parseCustomerContactIdInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'customers.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const contact = deactivateCustomerContact(db, input.contactId, {
          type: 'user',
          userId: authResult.callerUserId
        })
        return { success: true, contact: toSafeCustomerContact(contact) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    CUSTOMER_CONTACTS_REACTIVATE_CHANNEL,
    (event, rawInput: unknown): MutateCustomerContactResult => {
      requireApprovedSender(event, context)

      let input: CustomerContactIdInput
      try {
        input = parseCustomerContactIdInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'customers.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const contact = reactivateCustomerContact(db, input.contactId, {
          type: 'user',
          userId: authResult.callerUserId
        })
        return { success: true, contact: toSafeCustomerContact(contact) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )
}
