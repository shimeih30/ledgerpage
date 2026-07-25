import { useEffect, useState } from 'react'
import {
  auditBannerStyle,
  auditBodyCellStyle,
  auditColors,
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
import type { SafeSupplier } from '../../../shared/ipc/suppliers'

interface SupplierListScreenProps {
  canManageSuppliers: boolean
  onOpenSupplier: (supplierId: string) => void
  onCreateSupplier: () => void
}

type LoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; suppliers: SafeSupplier[] }

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

function fetchSuppliers(setState: (next: LoadState) => void): void {
  window.ledgerpage
    .listSuppliers()
    .then((result) => {
      if (!result.success) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', suppliers: result.suppliers })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

/**
 * Every mutating action here (deactivate/reactivate, and the New
 * supplier button) is only ever offered when canManageSuppliers is
 * true — but that flag is cosmetic only, matching every prior
 * canManage* precedent. The real boundary is
 * suppliers:deactivate/suppliers:reactivate's own
 * requireAuthorizedCaller('suppliers.manage') check, resolved fresh
 * from SQLite on every call in the main process.
 */
export function SupplierListScreen({
  canManageSuppliers,
  onOpenSupplier,
  onCreateSupplier
}: SupplierListScreenProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const [busySupplierId, setBusySupplierId] = useState<string | undefined>(undefined)

  useEffect(() => {
    fetchSuppliers(setState)
  }, [])

  async function handleDeactivate(supplierId: string): Promise<void> {
    if (busySupplierId !== undefined) {
      return
    }
    setActionError(undefined)
    setBusySupplierId(supplierId)
    try {
      const result = await window.ledgerpage.deactivateSupplier({ supplierId })
      if (!result.success) {
        setActionError('Something went wrong. Try again.')
        return
      }
      setState({ kind: 'loading' })
      fetchSuppliers(setState)
    } catch {
      setActionError('Something went wrong. Try again.')
    } finally {
      setBusySupplierId(undefined)
    }
  }

  async function handleReactivate(supplierId: string): Promise<void> {
    if (busySupplierId !== undefined) {
      return
    }
    setActionError(undefined)
    setBusySupplierId(supplierId)
    try {
      const result = await window.ledgerpage.reactivateSupplier({ supplierId })
      if (!result.success) {
        setActionError('Something went wrong. Try again.')
        return
      }
      setState({ kind: 'loading' })
      fetchSuppliers(setState)
    } catch {
      setActionError('Something went wrong. Try again.')
    } finally {
      setBusySupplierId(undefined)
    }
  }

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>Suppliers</h1>
        {canManageSuppliers && (
          <button type="button" onClick={onCreateSupplier} style={auditPrimaryButtonStyle}>
            New supplier
          </button>
        )}
      </div>

      {actionError && <div style={auditBannerStyle}>{actionError}</div>}

      {state.kind === 'loading' && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      )}

      {state.kind === 'error' && (
        <div style={auditBannerStyle}>Couldn&rsquo;t load suppliers. Try reloading the app.</div>
      )}

      {state.kind === 'ready' && state.suppliers.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>No suppliers yet.</p>
      )}

      {state.kind === 'ready' && state.suppliers.length > 0 && (
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
              {state.suppliers.map((supplier, index) => (
                <tr
                  key={supplier.id}
                  style={{
                    borderBottom:
                      index === state.suppliers.length - 1
                        ? 'none'
                        : `1px solid ${auditColors.border}`
                  }}
                >
                  <td style={{ ...auditBodyCellStyle, fontFamily: 'ui-monospace, monospace' }}>
                    {supplier.code}
                  </td>
                  <td style={auditBodyCellStyle}>{supplier.name}</td>
                  <td style={{ ...auditBodyCellStyle, color: auditColors.mutedInk }}>
                    {supplier.contactDetails ?? '\u2014'}
                  </td>
                  <td style={auditBodyCellStyle}>
                    <span style={statusBadgeStyle(supplier.isActive)}>
                      {supplier.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={auditBodyCellStyle}>
                    <button
                      type="button"
                      onClick={() => onOpenSupplier(supplier.id)}
                      style={auditGhostButtonStyle}
                    >
                      {canManageSuppliers ? 'Edit' : 'View'}
                    </button>
                    {canManageSuppliers && supplier.isActive && (
                      <button
                        type="button"
                        onClick={() => void handleDeactivate(supplier.id)}
                        disabled={busySupplierId !== undefined}
                        style={{
                          ...auditGhostButtonStyle,
                          marginLeft: '0.75rem',
                          opacity: busySupplierId === supplier.id ? 0.7 : 1
                        }}
                      >
                        {busySupplierId === supplier.id ? 'Deactivating\u2026' : 'Deactivate'}
                      </button>
                    )}
                    {canManageSuppliers && !supplier.isActive && (
                      <button
                        type="button"
                        onClick={() => void handleReactivate(supplier.id)}
                        disabled={busySupplierId !== undefined}
                        style={{
                          ...auditGhostButtonStyle,
                          marginLeft: '0.75rem',
                          opacity: busySupplierId === supplier.id ? 0.7 : 1
                        }}
                      >
                        {busySupplierId === supplier.id ? 'Reactivating\u2026' : 'Reactivate'}
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
