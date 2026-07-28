import { useEffect, useMemo, useState } from 'react'
import {
  auditBannerStyle,
  auditBodyCellStyle,
  auditColors,
  auditFieldStyle,
  auditFilterBarStyle,
  auditGhostButtonStyle,
  auditHeaderCellStyle,
  auditHeaderRowStyle,
  auditHeadingStyle,
  auditPageStyle,
  auditPanelStyle,
  auditPrimaryButtonStyle,
  auditTableStyle
} from '../shared/ui'
import type { SafeCustomer } from '../../../shared/ipc/customers'

interface CustomerListScreenProps {
  canManageCustomers: boolean
  onOpenCustomer: (customerId: string) => void
  onCreateCustomer: () => void
}

type LoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; customers: SafeCustomer[] }

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

function fetchCustomers(setState: (next: LoadState) => void): void {
  window.ledgerpage
    .listCustomers()
    .then((result) => {
      if (!result.success) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', customers: result.customers })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

/**
 * Client-side, case-insensitive search over code/name/contactDetails
 * only (approved decision) — no server-side search, no pagination, no
 * full-text index, and no dedicated search IPC channel; the renderer
 * already has the full customer list in memory from listCustomers, and
 * filters it locally.
 */
function matchesSearch(customer: SafeCustomer, query: string): boolean {
  if (query === '') {
    return true
  }
  const needle = query.toLowerCase()
  return (
    customer.code.toLowerCase().includes(needle) ||
    customer.name.toLowerCase().includes(needle) ||
    (customer.contactDetails?.toLowerCase().includes(needle) ?? false)
  )
}

/**
 * Every mutating action here (deactivate/reactivate, and the New
 * customer button) is only ever offered when canManageCustomers is
 * true — but that flag is cosmetic only, matching every prior
 * canManage* precedent. The real boundary is
 * customers:deactivate/customers:reactivate's own
 * requireAuthorizedCaller('customers.manage') check, resolved fresh
 * from SQLite on every call in the main process. Tested defensively
 * with canManageCustomers=false even though every currently-defined
 * role manages customers.
 */
export function CustomerListScreen({
  canManageCustomers,
  onOpenCustomer,
  onCreateCustomer
}: CustomerListScreenProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const [busyCustomerId, setBusyCustomerId] = useState<string | undefined>(undefined)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    fetchCustomers(setState)
  }, [])

  const filteredCustomers = useMemo(() => {
    if (state.kind !== 'ready') {
      return []
    }
    return state.customers.filter((customer) => matchesSearch(customer, searchQuery))
  }, [state, searchQuery])

  async function handleDeactivate(customerId: string): Promise<void> {
    if (busyCustomerId !== undefined) {
      return
    }
    setActionError(undefined)
    setBusyCustomerId(customerId)
    try {
      const result = await window.ledgerpage.deactivateCustomer({ customerId })
      if (!result.success) {
        setActionError('Something went wrong. Try again.')
        return
      }
      setState({ kind: 'loading' })
      fetchCustomers(setState)
    } catch {
      setActionError('Something went wrong. Try again.')
    } finally {
      setBusyCustomerId(undefined)
    }
  }

  async function handleReactivate(customerId: string): Promise<void> {
    if (busyCustomerId !== undefined) {
      return
    }
    setActionError(undefined)
    setBusyCustomerId(customerId)
    try {
      const result = await window.ledgerpage.reactivateCustomer({ customerId })
      if (!result.success) {
        setActionError('Something went wrong. Try again.')
        return
      }
      setState({ kind: 'loading' })
      fetchCustomers(setState)
    } catch {
      setActionError('Something went wrong. Try again.')
    } finally {
      setBusyCustomerId(undefined)
    }
  }

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>Customers</h1>
        {canManageCustomers && (
          <button type="button" onClick={onCreateCustomer} style={auditPrimaryButtonStyle}>
            New customer
          </button>
        )}
      </div>

      {state.kind === 'ready' && state.customers.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <label htmlFor="customer-search" style={{ display: 'none' }}>
            Search customers
          </label>
          <input
            id="customer-search"
            type="text"
            placeholder="Search by code, name, or contact details…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            style={{ ...auditFieldStyle(), maxWidth: '24rem' }}
          />
        </div>
      )}

      {actionError && <div style={auditBannerStyle}>{actionError}</div>}

      {state.kind === 'loading' && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      )}

      {state.kind === 'error' && (
        <div style={auditBannerStyle}>Couldn&rsquo;t load customers. Try reloading the app.</div>
      )}

      {state.kind === 'ready' && state.customers.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>No customers yet.</p>
      )}

      {state.kind === 'ready' && state.customers.length > 0 && filteredCustomers.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>
          No customers match &ldquo;{searchQuery}&rdquo;.
        </p>
      )}

      {state.kind === 'ready' && filteredCustomers.length > 0 && (
        <div style={auditPanelStyle}>
          <table style={auditTableStyle}>
            <thead>
              <tr style={auditHeaderRowStyle}>
                <th style={auditHeaderCellStyle}>Code</th>
                <th style={auditHeaderCellStyle}>Name</th>
                <th style={auditHeaderCellStyle}>Contact</th>
                <th style={auditHeaderCellStyle}>Status</th>
                <th style={auditHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((customer, index) => (
                <tr
                  key={customer.id}
                  style={{
                    borderBottom:
                      index === filteredCustomers.length - 1
                        ? 'none'
                        : `1px solid ${auditColors.border}`
                  }}
                >
                  <td style={{ ...auditBodyCellStyle, fontFamily: 'ui-monospace, monospace' }}>
                    {customer.code}
                  </td>
                  <td style={auditBodyCellStyle}>{customer.name}</td>
                  <td style={{ ...auditBodyCellStyle, color: auditColors.mutedInk }}>
                    {customer.contactDetails ?? '\u2014'}
                  </td>
                  <td style={auditBodyCellStyle}>
                    <span style={statusBadgeStyle(customer.isActive)}>
                      {customer.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={auditBodyCellStyle}>
                    <button
                      type="button"
                      onClick={() => onOpenCustomer(customer.id)}
                      style={auditGhostButtonStyle}
                    >
                      {canManageCustomers ? 'Edit' : 'View'}
                    </button>
                    {canManageCustomers && customer.isActive && (
                      <button
                        type="button"
                        onClick={() => void handleDeactivate(customer.id)}
                        disabled={busyCustomerId !== undefined}
                        style={{
                          ...auditGhostButtonStyle,
                          marginLeft: '0.75rem',
                          opacity: busyCustomerId === customer.id ? 0.7 : 1
                        }}
                      >
                        {busyCustomerId === customer.id ? 'Deactivating\u2026' : 'Deactivate'}
                      </button>
                    )}
                    {canManageCustomers && !customer.isActive && (
                      <button
                        type="button"
                        onClick={() => void handleReactivate(customer.id)}
                        disabled={busyCustomerId !== undefined}
                        style={{
                          ...auditGhostButtonStyle,
                          marginLeft: '0.75rem',
                          opacity: busyCustomerId === customer.id ? 0.7 : 1
                        }}
                      >
                        {busyCustomerId === customer.id ? 'Reactivating\u2026' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
