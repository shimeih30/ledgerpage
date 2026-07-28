import { useEffect, useState } from 'react'
import {
  auditBannerStyle,
  auditColors,
  auditFieldGroupStyle,
  auditFieldStyle,
  auditFilterBarStyle,
  auditGhostButtonStyle,
  auditHeadingStyle,
  auditLabelStyle,
  auditPageStyle,
  auditPanelStyle,
  auditPrimaryButtonStyle
} from '../shared/ui'
import type { SafeCustomer, SafeCustomerContact } from '../../../shared/ipc/customers'
import {
  formatMinorUnitsAsCreditLimit,
  parseCreditLimitToMinorUnits
} from './customerCreditDecimal'

interface CustomerDetailScreenProps {
  customerId?: string
  canManageCustomers: boolean
  onBack: () => void
  onSaved: (customerId: string) => void
}

type CustomerState =
  | { kind: 'creating' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; customer: SafeCustomer }

function statusBadgeStyle(isActive: boolean) {
  return {
    display: 'inline-block' as const,
    fontSize: '0.6875rem',
    fontWeight: 600,
    padding: '0.125rem 0.4375rem',
    borderRadius: '4px',
    backgroundColor: isActive ? '#EAF3DE' : '#FAEEDA',
    color: isActive ? '#27500A' : '#633806'
  }
}

/**
 * Strict non-negative integer parsing for paymentTermsDays -- digits
 * only, no decimal point, no sign, no leading/trailing junk. "5", "0"
 * valid; "5.5", "-5", "+5", "abc" all invalid. A blank (post-trim)
 * input is a valid "no default configured" and returns null, distinct
 * from an invalid value (undefined). Deliberately not `Number(value)`
 * + `Number.isInteger()`, since `Number("+5")` silently strips the
 * sign and parses to 5, which would incorrectly accept "+5".
 */
const PAYMENT_TERMS_DAYS_PATTERN = /^\d+$/

function parsePaymentTermsDays(rawInput: string): number | null | undefined {
  const trimmed = rawInput.trim()
  if (trimmed === '') {
    return null
  }
  if (!PAYMENT_TERMS_DAYS_PATTERN.test(trimmed)) {
    return undefined
  }
  const value = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(value) ? value : undefined
}

async function loadCustomer(
  customerId: string,
  setState: (next: CustomerState) => void,
  applyLoadedFields: (customer: SafeCustomer) => void
): Promise<void> {
  try {
    const result = await window.ledgerpage.getCustomer({ customerId })
    if (!result.success) {
      setState({ kind: 'error' })
      return
    }
    setState({ kind: 'ready', customer: result.customer })
    applyLoadedFields(result.customer)
  } catch {
    setState({ kind: 'error' })
  }
}

/**
 * Every mutating control here (edit fields, deactivate/reactivate, and
 * the entire contacts section's add/edit/deactivate/reactivate
 * controls) is only ever rendered when canManageCustomers is true —
 * cosmetic only, matching every prior canManage* precedent. The real
 * boundary is each customers handler's own
 * requireAuthorizedCaller('customers.manage') check.
 *
 * code is never accepted as update input anywhere in this file —
 * UpdateCustomerInput (shared/ipc/customers.ts) has no such field, a
 * structural guarantee. currencyId is never accepted or submitted by
 * this screen at all; the server always assigns FUNCTIONAL_CURRENCY_ID.
 * There is no delete/remove control for a contact anywhere here —
 * customer_contacts uses soft activation only.
 */
export function CustomerDetailScreen({
  customerId,
  canManageCustomers,
  onBack,
  onSaved
}: CustomerDetailScreenProps) {
  const [state, setState] = useState<CustomerState>(
    customerId ? { kind: 'loading' } : { kind: 'creating' }
  )

  const [createName, setCreateName] = useState('')
  const [createContactDetails, setCreateContactDetails] = useState('')
  const [createPaymentTermsDays, setCreatePaymentTermsDays] = useState('')
  const [createCreditLimit, setCreateCreditLimit] = useState('')
  const [createError, setCreateError] = useState<string | undefined>(undefined)
  const [isCreating, setIsCreating] = useState(false)

  const [editName, setEditName] = useState('')
  const [editContactDetails, setEditContactDetails] = useState('')
  const [editPaymentTermsDays, setEditPaymentTermsDays] = useState('')
  const [editCreditLimit, setEditCreditLimit] = useState('')
  const [editError, setEditError] = useState<string | undefined>(undefined)
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const [isToggling, setIsToggling] = useState(false)

  const [contacts, setContacts] = useState<SafeCustomerContact[]>([])
  const [contactsError, setContactsError] = useState<string | undefined>(undefined)

  const [contactFormMode, setContactFormMode] = useState<
    { kind: 'none' } | { kind: 'adding' } | { kind: 'editing'; contactId: string }
  >({ kind: 'none' })
  const [contactName, setContactName] = useState('')
  const [contactRole, setContactRole] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactFormError, setContactFormError] = useState<string | undefined>(undefined)
  const [isSavingContact, setIsSavingContact] = useState(false)
  const [busyContactId, setBusyContactId] = useState<string | undefined>(undefined)

  function applyLoadedFields(customer: SafeCustomer): void {
    setEditName(customer.name)
    setEditContactDetails(customer.contactDetails ?? '')
    setEditPaymentTermsDays(
      customer.paymentTermsDays === null ? '' : String(customer.paymentTermsDays)
    )
    setEditCreditLimit(formatMinorUnitsAsCreditLimit(customer.creditLimitMinor))
  }

  function reloadContacts(currentCustomerId: string): void {
    window.ledgerpage
      .listContactsForCustomer({ customerId: currentCustomerId })
      .then((result) => {
        if (!result.success) {
          setContactsError('Something went wrong loading contacts.')
          return
        }
        setContactsError(undefined)
        setContacts(result.contacts)
      })
      .catch(() => {
        setContactsError('Something went wrong loading contacts.')
      })
  }

  useEffect(() => {
    if (customerId) {
      void loadCustomer(customerId, setState, applyLoadedFields)
      reloadContacts(customerId)
    }
  }, [customerId])

  async function handleCreate(): Promise<void> {
    if (isCreating) {
      return
    }
    const paymentTermsDays = parsePaymentTermsDays(createPaymentTermsDays)
    if (paymentTermsDays === undefined) {
      setCreateError('Enter a whole, non-negative number of payment-term days, or leave it blank.')
      return
    }
    const creditLimitMinor = parseCreditLimitToMinorUnits(createCreditLimit)
    if (creditLimitMinor === undefined) {
      setCreateError('Enter a valid credit limit, e.g. 10 or 10.29, or leave it blank.')
      return
    }

    setCreateError(undefined)
    setIsCreating(true)
    try {
      const result = await window.ledgerpage.createCustomer({
        name: createName,
        contactDetails: createContactDetails,
        paymentTermsDays,
        creditLimitMinor
      })
      if (!result.success) {
        setCreateError(describeCustomerError(result.errorCode))
        return
      }
      setState({ kind: 'ready', customer: result.customer })
      applyLoadedFields(result.customer)
      onSaved(result.customer.id)
    } catch {
      setCreateError('Something went wrong. Try again.')
    } finally {
      setIsCreating(false)
    }
  }

  async function handleSaveEdit(): Promise<void> {
    if (state.kind !== 'ready' || isSavingEdit) {
      return
    }
    const paymentTermsDays = parsePaymentTermsDays(editPaymentTermsDays)
    if (paymentTermsDays === undefined) {
      setEditError('Enter a whole, non-negative number of payment-term days, or leave it blank.')
      return
    }
    const creditLimitMinor = parseCreditLimitToMinorUnits(editCreditLimit)
    if (creditLimitMinor === undefined) {
      setEditError('Enter a valid credit limit, e.g. 10 or 10.29, or leave it blank.')
      return
    }

    setEditError(undefined)
    setIsSavingEdit(true)
    try {
      const result = await window.ledgerpage.updateCustomer({
        customerId: state.customer.id,
        name: editName,
        contactDetails: editContactDetails,
        paymentTermsDays,
        creditLimitMinor
      })
      if (!result.success) {
        setEditError(describeCustomerError(result.errorCode))
        return
      }
      setState({ kind: 'ready', customer: result.customer })
      applyLoadedFields(result.customer)
      onSaved(result.customer.id)
    } catch {
      setEditError('Something went wrong. Try again.')
    } finally {
      setIsSavingEdit(false)
    }
  }

  async function handleToggleActive(): Promise<void> {
    if (state.kind !== 'ready' || isToggling) {
      return
    }
    setActionError(undefined)
    setIsToggling(true)
    try {
      const result = state.customer.isActive
        ? await window.ledgerpage.deactivateCustomer({ customerId: state.customer.id })
        : await window.ledgerpage.reactivateCustomer({ customerId: state.customer.id })
      if (!result.success) {
        setActionError(describeCustomerError(result.errorCode))
        return
      }
      setState({ kind: 'ready', customer: result.customer })
    } catch {
      setActionError('Something went wrong. Try again.')
    } finally {
      setIsToggling(false)
    }
  }

  function startAddingContact(): void {
    setContactFormMode({ kind: 'adding' })
    setContactName('')
    setContactRole('')
    setContactPhone('')
    setContactEmail('')
    setContactFormError(undefined)
  }

  function startEditingContact(contact: SafeCustomerContact): void {
    setContactFormMode({ kind: 'editing', contactId: contact.id })
    setContactName(contact.name)
    setContactRole(contact.role ?? '')
    setContactPhone(contact.phone ?? '')
    setContactEmail(contact.email ?? '')
    setContactFormError(undefined)
  }

  function cancelContactForm(): void {
    setContactFormMode({ kind: 'none' })
    setContactFormError(undefined)
  }

  async function handleSaveContact(): Promise<void> {
    if (state.kind !== 'ready' || isSavingContact || contactFormMode.kind === 'none') {
      return
    }
    setContactFormError(undefined)
    setIsSavingContact(true)
    try {
      const result =
        contactFormMode.kind === 'adding'
          ? await window.ledgerpage.createCustomerContact({
              customerId: state.customer.id,
              name: contactName,
              role: contactRole,
              phone: contactPhone,
              email: contactEmail
            })
          : await window.ledgerpage.updateCustomerContact({
              contactId: contactFormMode.contactId,
              name: contactName,
              role: contactRole,
              phone: contactPhone,
              email: contactEmail
            })
      if (!result.success) {
        setContactFormError(describeCustomerError(result.errorCode))
        return
      }
      setContactFormMode({ kind: 'none' })
      reloadContacts(state.customer.id)
    } catch {
      setContactFormError('Something went wrong. Try again.')
    } finally {
      setIsSavingContact(false)
    }
  }

  async function handleToggleContactActive(contact: SafeCustomerContact): Promise<void> {
    if (state.kind !== 'ready' || busyContactId !== undefined) {
      return
    }
    setContactsError(undefined)
    setBusyContactId(contact.id)
    try {
      const result = contact.isActive
        ? await window.ledgerpage.deactivateCustomerContact({ contactId: contact.id })
        : await window.ledgerpage.reactivateCustomerContact({ contactId: contact.id })
      if (!result.success) {
        setContactsError(describeCustomerError(result.errorCode))
        return
      }
      reloadContacts(state.customer.id)
    } catch {
      setContactsError('Something went wrong. Try again.')
    } finally {
      setBusyContactId(undefined)
    }
  }

  if (state.kind === 'creating') {
    return (
      <div style={auditPageStyle}>
        <div style={auditFilterBarStyle}>
          <h1 style={auditHeadingStyle}>New customer</h1>
          <button type="button" onClick={onBack} style={auditGhostButtonStyle}>
            Back
          </button>
        </div>

        {createError && <div style={auditBannerStyle}>{createError}</div>}

        <div style={auditPanelStyle}>
          <div
            style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={auditFieldGroupStyle}>
                <label htmlFor="customer-create-name" style={auditLabelStyle}>
                  Name
                </label>
                <input
                  id="customer-create-name"
                  type="text"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="customer-create-contact" style={auditLabelStyle}>
                  Contact details (optional)
                </label>
                <input
                  id="customer-create-contact"
                  type="text"
                  value={createContactDetails}
                  onChange={(event) => setCreateContactDetails(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="customer-create-terms" style={auditLabelStyle}>
                  Payment terms (days, optional)
                </label>
                <input
                  id="customer-create-terms"
                  type="text"
                  inputMode="numeric"
                  value={createPaymentTermsDays}
                  onChange={(event) => setCreatePaymentTermsDays(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="customer-create-credit" style={auditLabelStyle}>
                  Credit limit (optional)
                </label>
                <input
                  id="customer-create-credit"
                  type="text"
                  inputMode="decimal"
                  value={createCreditLimit}
                  onChange={(event) => setCreateCreditLimit(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={isCreating}
                style={{ ...auditPrimaryButtonStyle, opacity: isCreating ? 0.7 : 1 }}
              >
                {isCreating ? 'Creating\u2026' : 'Create customer'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (state.kind === 'loading') {
    return (
      <div style={auditPageStyle}>
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div style={auditPageStyle}>
        <div style={auditBannerStyle}>
          Couldn&rsquo;t load this customer. Try reloading the app.
        </div>
      </div>
    )
  }

  const { customer } = state

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>{customer.name}</h1>
        <button type="button" onClick={onBack} style={auditGhostButtonStyle}>
          Back
        </button>
      </div>

      {actionError && <div style={auditBannerStyle}>{actionError}</div>}

      <div style={auditPanelStyle}>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <span style={auditLabelStyle}>Code</span>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.9375rem' }}>
                {customer.code}
              </div>
            </div>
            <div>
              <span style={auditLabelStyle}>Status</span>
              <div style={{ marginTop: '0.125rem' }}>
                <span style={statusBadgeStyle(customer.isActive)}>
                  {customer.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>

          {canManageCustomers ? (
            <>
              {editError && <div style={auditBannerStyle}>{editError}</div>}

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={auditFieldGroupStyle}>
                  <label htmlFor="customer-edit-name" style={auditLabelStyle}>
                    Name
                  </label>
                  <input
                    id="customer-edit-name"
                    type="text"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>

                <div style={auditFieldGroupStyle}>
                  <label htmlFor="customer-edit-contact" style={auditLabelStyle}>
                    Contact details (optional)
                  </label>
                  <input
                    id="customer-edit-contact"
                    type="text"
                    value={editContactDetails}
                    onChange={(event) => setEditContactDetails(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>

                <div style={auditFieldGroupStyle}>
                  <label htmlFor="customer-edit-terms" style={auditLabelStyle}>
                    Payment terms (days, optional)
                  </label>
                  <input
                    id="customer-edit-terms"
                    type="text"
                    inputMode="numeric"
                    value={editPaymentTermsDays}
                    onChange={(event) => setEditPaymentTermsDays(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>

                <div style={auditFieldGroupStyle}>
                  <label htmlFor="customer-edit-credit" style={auditLabelStyle}>
                    Credit limit (optional)
                  </label>
                  <input
                    id="customer-edit-credit"
                    type="text"
                    inputMode="decimal"
                    value={editCreditLimit}
                    onChange={(event) => setEditCreditLimit(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => void handleSaveEdit()}
                  disabled={isSavingEdit}
                  style={{ ...auditPrimaryButtonStyle, opacity: isSavingEdit ? 0.7 : 1 }}
                >
                  {isSavingEdit ? 'Saving\u2026' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleActive()}
                  disabled={isToggling}
                  style={{ ...auditGhostButtonStyle, opacity: isToggling ? 0.7 : 1 }}
                >
                  {customer.isActive ? 'Deactivate customer' : 'Reactivate customer'}
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem', margin: 0 }}>
              Contact: {customer.contactDetails ?? '\u2014'}
            </p>
          )}
        </div>
      </div>

      <div style={auditPanelStyle}>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ ...auditHeadingStyle, fontSize: '1.0625rem', margin: 0 }}>Contacts</h2>
            {canManageCustomers && customer.isActive && contactFormMode.kind === 'none' && (
              <button type="button" onClick={startAddingContact} style={auditGhostButtonStyle}>
                Add contact
              </button>
            )}
          </div>

          {canManageCustomers && !customer.isActive && (
            <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem', margin: 0 }}>
              This customer is inactive. Reactivate it to add or change contacts.
            </p>
          )}

          {contactsError && <div style={auditBannerStyle}>{contactsError}</div>}

          {canManageCustomers && customer.isActive && contactFormMode.kind !== 'none' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                padding: '0.75rem',
                border: `1px solid ${auditColors.border}`,
                borderRadius: '6px'
              }}
            >
              {contactFormError && <div style={auditBannerStyle}>{contactFormError}</div>}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={auditFieldGroupStyle}>
                  <label htmlFor="contact-name" style={auditLabelStyle}>
                    Name
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    value={contactName}
                    onChange={(event) => setContactName(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>
                <div style={auditFieldGroupStyle}>
                  <label htmlFor="contact-role" style={auditLabelStyle}>
                    Role (optional)
                  </label>
                  <input
                    id="contact-role"
                    type="text"
                    value={contactRole}
                    onChange={(event) => setContactRole(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>
                <div style={auditFieldGroupStyle}>
                  <label htmlFor="contact-phone" style={auditLabelStyle}>
                    Phone (optional)
                  </label>
                  <input
                    id="contact-phone"
                    type="text"
                    value={contactPhone}
                    onChange={(event) => setContactPhone(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>
                <div style={auditFieldGroupStyle}>
                  <label htmlFor="contact-email" style={auditLabelStyle}>
                    Email (optional)
                  </label>
                  <input
                    id="contact-email"
                    type="text"
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => void handleSaveContact()}
                  disabled={isSavingContact}
                  style={{ ...auditPrimaryButtonStyle, opacity: isSavingContact ? 0.7 : 1 }}
                >
                  {isSavingContact
                    ? 'Saving\u2026'
                    : contactFormMode.kind === 'adding'
                      ? 'Add contact'
                      : 'Save contact'}
                </button>
                <button type="button" onClick={cancelContactForm} style={auditGhostButtonStyle}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {contacts.length === 0 && !contactsError && (
            <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem', margin: 0 }}>
              No contacts yet.
            </p>
          )}

          {contacts.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: auditColors.mutedInk }}>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Name</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Role</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Phone</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Email</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Status</th>
                  {canManageCustomers && <th style={{ padding: '0.375rem 0.5rem' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id} style={{ borderTop: `1px solid ${auditColors.border}` }}>
                    <td style={{ padding: '0.375rem 0.5rem' }}>{contact.name}</td>
                    <td style={{ padding: '0.375rem 0.5rem' }}>{contact.role ?? '\u2014'}</td>
                    <td style={{ padding: '0.375rem 0.5rem' }}>{contact.phone ?? '\u2014'}</td>
                    <td style={{ padding: '0.375rem 0.5rem' }}>{contact.email ?? '\u2014'}</td>
                    <td style={{ padding: '0.375rem 0.5rem' }}>
                      <span style={statusBadgeStyle(contact.isActive)}>
                        {contact.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManageCustomers && (
                      <td style={{ padding: '0.375rem 0.5rem' }}>
                        {customer.isActive && (
                          <>
                            <button
                              type="button"
                              onClick={() => startEditingContact(contact)}
                              style={auditGhostButtonStyle}
                            >
                              Edit
                            </button>
                            {contact.isActive ? (
                              <button
                                type="button"
                                onClick={() => void handleToggleContactActive(contact)}
                                disabled={busyContactId !== undefined}
                                style={{ ...auditGhostButtonStyle, marginLeft: '0.5rem' }}
                              >
                                {busyContactId === contact.id ? 'Deactivating\u2026' : 'Deactivate'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleToggleContactActive(contact)}
                                disabled={busyContactId !== undefined}
                                style={{ ...auditGhostButtonStyle, marginLeft: '0.5rem' }}
                              >
                                {busyContactId === contact.id ? 'Reactivating\u2026' : 'Reactivate'}
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function describeCustomerError(errorCode: string): string {
  switch (errorCode) {
    case 'invalid_input':
      return 'Check the fields above: a value is missing or invalid, or the customer is not active.'
    case 'not_authorized':
      return 'You don\u2019t have permission to do that.'
    case 'session_invalid':
      return 'Your session is no longer active. Try signing in again.'
    case 'not_found':
      return 'This customer could not be found.'
    default:
      return 'Something went wrong. Try again.'
  }
}
