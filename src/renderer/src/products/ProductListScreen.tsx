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
import type { SafeProduct } from '../../../shared/ipc/products'

interface ProductListScreenProps {
  canManageProducts: boolean
  onOpenProduct: (productId: string) => void
  onCreateProduct: () => void
}

type LoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; products: SafeProduct[] }

/**
 * Small, local status badge for a product's own active/inactive state —
 * distinct from auditActionBadgeStyle (which colors an audit-log
 * action, not a current status). Active reads as routine/positive
 * (green); inactive as a quieter, cautionary amber — matching the same
 * semantic color language the Audit Log screen already established.
 */
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

function fetchProducts(setState: (next: LoadState) => void): void {
  window.ledgerpage
    .listProducts()
    .then((result) => {
      if (!result.success) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', products: result.products })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

/**
 * Every mutating action here (deactivate/reactivate) is only ever
 * offered in this UI when canManageProducts is true — but that flag is
 * cosmetic only, exactly like canViewAuditLog before it. The real
 * boundary is products:deactivate/products:reactivate's own
 * requireAuthorizedCaller('products.manage') check, resolved fresh from
 * SQLite on every call in the main process, completely independent of
 * anything this renderer shows, hides, or believes about the current
 * session.
 */
export function ProductListScreen({
  canManageProducts,
  onOpenProduct,
  onCreateProduct
}: ProductListScreenProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  // Tracks the one product currently mid-mutation, if any — guards
  // against a rapid repeated click firing more than one IPC call for
  // the same row while its first request is still in flight.
  const [busyProductId, setBusyProductId] = useState<string | undefined>(undefined)

  // Mirrors AuditLogScreen's own established pattern: the mount effect
  // calls fetchProducts directly, with no synchronous setState of its
  // own (the initial `{ kind: 'loading' }` state already comes from
  // useState above) — an event handler, not being an effect, is free to
  // setState synchronously before re-fetching after a mutation.
  useEffect(() => {
    fetchProducts(setState)
  }, [])

  async function handleDeactivate(productId: string): Promise<void> {
    if (busyProductId !== undefined) {
      return
    }
    setActionError(undefined)
    setBusyProductId(productId)
    try {
      const result = await window.ledgerpage.deactivateProduct({ productId })
      if (!result.success) {
        setActionError('Something went wrong. Try again.')
        return
      }
      setState({ kind: 'loading' })
      fetchProducts(setState)
    } catch {
      setActionError('Something went wrong. Try again.')
    } finally {
      setBusyProductId(undefined)
    }
  }

  async function handleReactivate(productId: string): Promise<void> {
    if (busyProductId !== undefined) {
      return
    }
    setActionError(undefined)
    setBusyProductId(productId)
    try {
      const result = await window.ledgerpage.reactivateProduct({ productId })
      if (!result.success) {
        setActionError('Something went wrong. Try again.')
        return
      }
      setState({ kind: 'loading' })
      fetchProducts(setState)
    } catch {
      setActionError('Something went wrong. Try again.')
    } finally {
      setBusyProductId(undefined)
    }
  }

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>Products</h1>
        {canManageProducts && (
          <button type="button" onClick={onCreateProduct} style={auditPrimaryButtonStyle}>
            New product
          </button>
        )}
      </div>

      {actionError && <div style={auditBannerStyle}>{actionError}</div>}

      {state.kind === 'loading' && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      )}

      {state.kind === 'error' && (
        <div style={auditBannerStyle}>Couldn&rsquo;t load products. Try reloading the app.</div>
      )}

      {state.kind === 'ready' && state.products.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>No products yet.</p>
      )}

      {state.kind === 'ready' && state.products.length > 0 && (
        <div style={auditPanelStyle}>
          <table style={auditTableStyle}>
            <thead>
              <tr style={auditHeaderRowStyle}>
                <th style={auditHeaderCellStyle}>Code</th>
                <th style={auditHeaderCellStyle}>Name</th>
                <th style={auditHeaderCellStyle}>Type</th>
                <th style={auditHeaderCellStyle}>Status</th>
                <th style={auditHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.products.map((product, index) => (
                <tr
                  key={product.id}
                  style={{
                    borderBottom:
                      index === state.products.length - 1
                        ? 'none'
                        : `1px solid ${auditColors.border}`
                  }}
                >
                  <td style={{ ...auditBodyCellStyle, fontFamily: 'ui-monospace, monospace' }}>
                    {product.code}
                  </td>
                  <td style={auditBodyCellStyle}>{product.name}</td>
                  <td style={{ ...auditBodyCellStyle, color: auditColors.mutedInk }}>
                    {product.type}
                  </td>
                  <td style={auditBodyCellStyle}>
                    <span style={statusBadgeStyle(product.isActive)}>
                      {product.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={auditBodyCellStyle}>
                    <button
                      type="button"
                      onClick={() => onOpenProduct(product.id)}
                      style={auditGhostButtonStyle}
                    >
                      {canManageProducts ? 'Edit' : 'View'}
                    </button>
                    {canManageProducts && product.isActive && (
                      <button
                        type="button"
                        onClick={() => void handleDeactivate(product.id)}
                        disabled={busyProductId !== undefined}
                        style={{
                          ...auditGhostButtonStyle,
                          marginLeft: '0.75rem',
                          opacity: busyProductId === product.id ? 0.7 : 1
                        }}
                      >
                        {busyProductId === product.id ? 'Deactivating\u2026' : 'Deactivate'}
                      </button>
                    )}
                    {canManageProducts && !product.isActive && (
                      <button
                        type="button"
                        onClick={() => void handleReactivate(product.id)}
                        disabled={busyProductId !== undefined}
                        style={{
                          ...auditGhostButtonStyle,
                          marginLeft: '0.75rem',
                          opacity: busyProductId === product.id ? 0.7 : 1
                        }}
                      >
                        {busyProductId === product.id ? 'Reactivating\u2026' : 'Reactivate'}
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
