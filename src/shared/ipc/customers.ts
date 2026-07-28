/**
 * Shared IPC contract for Slice 14's customers and customer-contacts
 * channels.
 *
 * `code` never appears on UpdateCustomerInput — it is system-generated
 * at creation (via the existing frozen `customer` numbering rule) and
 * immutable thereafter. `currencyId` never appears on any customer
 * input at all — it is always FUNCTIONAL_CURRENCY_ID, assigned
 * server-side.
 *
 * There is no contact-delete channel anywhere in this contract —
 * customer_contacts uses soft activation only (deactivate/reactivate),
 * matching every other business record in this codebase; corrections
 * are made via update, and removal via deactivation.
 */

export const CUSTOMERS_LIST_CHANNEL = 'customers:list' as const
export const CUSTOMERS_GET_CHANNEL = 'customers:get' as const
export const CUSTOMERS_CREATE_CHANNEL = 'customers:create' as const
export const CUSTOMERS_UPDATE_CHANNEL = 'customers:update' as const
export const CUSTOMERS_DEACTIVATE_CHANNEL = 'customers:deactivate' as const
export const CUSTOMERS_REACTIVATE_CHANNEL = 'customers:reactivate' as const

export const CUSTOMER_CONTACTS_LIST_CHANNEL = 'customers:list-contacts' as const
export const CUSTOMER_CONTACTS_GET_CHANNEL = 'customers:get-contact' as const
export const CUSTOMER_CONTACTS_CREATE_CHANNEL = 'customers:create-contact' as const
export const CUSTOMER_CONTACTS_UPDATE_CHANNEL = 'customers:update-contact' as const
export const CUSTOMER_CONTACTS_DEACTIVATE_CHANNEL = 'customers:deactivate-contact' as const
export const CUSTOMER_CONTACTS_REACTIVATE_CHANNEL = 'customers:reactivate-contact' as const

export type CustomersErrorCode =
  'not_authorized' | 'invalid_input' | 'not_found' | 'session_invalid' | 'unexpected_error'

export interface SafeCustomer {
  id: string
  code: string
  name: string
  contactDetails: string | null
  paymentTermsDays: number | null
  creditLimitMinor: number | null
  currencyId: string
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export type ListCustomersResult =
  { success: true; customers: SafeCustomer[] } | { success: false; errorCode: CustomersErrorCode }

export interface CustomerIdInput {
  customerId: string
}

export type GetCustomerResult =
  { success: true; customer: SafeCustomer } | { success: false; errorCode: CustomersErrorCode }

export interface CreateCustomerInput {
  name: string
  contactDetails?: string | null
  paymentTermsDays?: number | null
  creditLimitMinor?: number | null
}

export type CreateCustomerResult =
  { success: true; customer: SafeCustomer } | { success: false; errorCode: CustomersErrorCode }

export interface UpdateCustomerInput {
  customerId: string
  name?: string
  contactDetails?: string | null
  paymentTermsDays?: number | null
  creditLimitMinor?: number | null
}

export type UpdateCustomerResult =
  { success: true; customer: SafeCustomer } | { success: false; errorCode: CustomersErrorCode }

export type MutateCustomerResult =
  { success: true; customer: SafeCustomer } | { success: false; errorCode: CustomersErrorCode }

export interface SafeCustomerContact {
  id: string
  customerId: string
  name: string
  role: string | null
  phone: string | null
  email: string | null
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export type ListCustomerContactsResult =
  | { success: true; contacts: SafeCustomerContact[] }
  | { success: false; errorCode: CustomersErrorCode }

export interface CustomerContactIdInput {
  contactId: string
}

export type GetCustomerContactResult =
  | { success: true; contact: SafeCustomerContact }
  | { success: false; errorCode: CustomersErrorCode }

export interface CreateCustomerContactInput {
  customerId: string
  name: string
  role?: string | null
  phone?: string | null
  email?: string | null
}

export type CreateCustomerContactResult =
  | { success: true; contact: SafeCustomerContact }
  | { success: false; errorCode: CustomersErrorCode }

export interface UpdateCustomerContactInput {
  contactId: string
  name?: string
  role?: string | null
  phone?: string | null
  email?: string | null
}

export type UpdateCustomerContactResult =
  | { success: true; contact: SafeCustomerContact }
  | { success: false; errorCode: CustomersErrorCode }

export type MutateCustomerContactResult =
  | { success: true; contact: SafeCustomerContact }
  | { success: false; errorCode: CustomersErrorCode }

export interface LedgerPageCustomersApi {
  listCustomers: () => Promise<ListCustomersResult>
  getCustomer: (input: CustomerIdInput) => Promise<GetCustomerResult>
  createCustomer: (input: CreateCustomerInput) => Promise<CreateCustomerResult>
  updateCustomer: (input: UpdateCustomerInput) => Promise<UpdateCustomerResult>
  deactivateCustomer: (input: CustomerIdInput) => Promise<MutateCustomerResult>
  reactivateCustomer: (input: CustomerIdInput) => Promise<MutateCustomerResult>
  listContactsForCustomer: (input: CustomerIdInput) => Promise<ListCustomerContactsResult>
  getCustomerContact: (input: CustomerContactIdInput) => Promise<GetCustomerContactResult>
  createCustomerContact: (input: CreateCustomerContactInput) => Promise<CreateCustomerContactResult>
  updateCustomerContact: (input: UpdateCustomerContactInput) => Promise<UpdateCustomerContactResult>
  deactivateCustomerContact: (input: CustomerContactIdInput) => Promise<MutateCustomerContactResult>
  reactivateCustomerContact: (input: CustomerContactIdInput) => Promise<MutateCustomerContactResult>
}
