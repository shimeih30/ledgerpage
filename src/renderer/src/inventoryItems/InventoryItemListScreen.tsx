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
import type { SafeInventoryItem } from '../../../shared/ipc/inventoryItems'

interface InventoryItemListScreenProps {
  canManageInventoryItems: boolean
  onOpenInventoryItem: (inventoryItemId: string) => void
  onCreateInventoryItem: () => void
}

type LoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; inventoryItems: SafeInventoryItem[] }

/**
 * Same status-badge language as ProductListScreen's own
 * statusBadgeStyle — active reads as routine/positive (green), inactive
 * as a quieter, cautionary amber.
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

function fetchInventoryItems(setState: (next: LoadState) => void): void {
  window.ledgerpage
    .listInventoryItems()
    .then((result) => {
      if (!result.success) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', inventoryItems: result.inventoryItems })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

/**
 * Every mutating action here (deactivate/reactivate) is only ever
 * offered in this UI when canManageInventoryItems is true — but that
 * flag is cosmetic only, exactly like canManageProducts before it. The
 * real boundary is inventory-items:deactivate/inventory-items:reactivate's
 * own requireAuthorizedCaller('inventory_items.manage') check, resolved
 * fresh from SQLite on every call in the main process, completely
 * independent of anything this renderer shows, hides, or believes about
 * the current session.
 */
export function InventoryItemListScreen({
  canManageInventoryItems,
  onOpenInventoryItem,
  onCreateInventoryItem
}: InventoryItemListScreenProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  // Tracks the one item currently mid-mutation, if any — guards against
  // a rapid repeated click firing more than one IPC call for the same
  // row while its first request is still in flight.
  const [busyInventoryItemId, setBusyInventoryItemId] = useState<string | undefined>(undefined)

  useEffect(() => {
    fetchInventoryItems(setState)
  }, [])

  async function handleDeactivate(inventoryItemId: string): Promise<void> {
    if (busyInventoryItemId !== undefined) {
      return
    }
    setActionError(undefined)
    setBusyInventoryItemId(inventoryItemId)
    try {
      const result = await window.ledgerpage.deactivateInventoryItem({ inventoryItemId })
      if (!result.success) {
        setActionError('Something went wrong. Try again.')
        return
      }
      setState({ kind: 'loading' })
      fetchInventoryItems(setState)
    } catch {
      setActionError('Something went wrong. Try again.')
    } finally {
      setBusyInventoryItemId(undefined)
    }
  }

  async function handleReactivate(inventoryItemId: string): Promise<void> {
    if (busyInventoryItemId !== undefined) {
      return
    }
    setActionError(undefined)
    setBusyInventoryItemId(inventoryItemId)
    try {
      const result = await window.ledgerpage.reactivateInventoryItem({ inventoryItemId })
      if (!result.success) {
        setActionError('Something went wrong. Try again.')
        return
      }
      setState({ kind: 'loading' })
      fetchInventoryItems(setState)
    } catch {
      setActionError('Something went wrong. Try again.')
    } finally {
      setBusyInventoryItemId(undefined)
    }
  }

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>Inventory Items</h1>
        {canManageInventoryItems && (
          <button type="button" onClick={onCreateInventoryItem} style={auditPrimaryButtonStyle}>
            New item
          </button>
        )}
      </div>

      {actionError && <div style={auditBannerStyle}>{actionError}</div>}

      {state.kind === 'loading' && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      )}

      {state.kind === 'error' && (
        <div style={auditBannerStyle}>
          Couldn&rsquo;t load inventory items. Try reloading the app.
        </div>
      )}

      {state.kind === 'ready' && state.inventoryItems.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>
          No inventory items yet.
        </p>
      )}

      {state.kind === 'ready' && state.inventoryItems.length > 0 && (
        <div style={auditPanelStyle}>
          <table style={auditTableStyle}>
            <thead>
              <tr style={auditHeaderRowStyle}>
                <th style={auditHeaderCellStyle}>Code</th>
                <th style={auditHeaderCellStyle}>Name</th>
                <th style={auditHeaderCellStyle}>Category</th>
                <th style={auditHeaderCellStyle}>Type</th>
                <th style={auditHeaderCellStyle}>Unit</th>
                <th style={auditHeaderCellStyle}>Status</th>
                <th style={auditHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.inventoryItems.map((item, index) => (
                <tr
                  key={item.id}
                  style={{
                    borderBottom:
                      index === state.inventoryItems.length - 1
                        ? 'none'
                        : `1px solid ${auditColors.border}`
                  }}
                >
                  <td style={{ ...auditBodyCellStyle, fontFamily: 'ui-monospace, monospace' }}>
                    {item.code}
                  </td>
                  <td style={auditBodyCellStyle}>{item.name}</td>
                  <td style={auditBodyCellStyle}>{item.category}</td>
                  <td style={{ ...auditBodyCellStyle, color: auditColors.mutedInk }}>
                    {item.itemType}
                  </td>
                  <td style={{ ...auditBodyCellStyle, color: auditColors.mutedInk }}>
                    {item.unitOfMeasureLabel}
                  </td>
                  <td style={auditBodyCellStyle}>
                    <span style={statusBadgeStyle(item.isActive)}>
                      {item.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={auditBodyCellStyle}>
                    <button
                      type="button"
                      onClick={() => onOpenInventoryItem(item.id)}
                      style={auditGhostButtonStyle}
                    >
                      {canManageInventoryItems ? 'Edit' : 'View'}
                    </button>
                    {canManageInventoryItems && item.isActive && (
                      <button
                        type="button"
                        onClick={() => void handleDeactivate(item.id)}
                        disabled={busyInventoryItemId !== undefined}
                        style={{
                          ...auditGhostButtonStyle,
                          marginLeft: '0.75rem',
                          opacity: busyInventoryItemId === item.id ? 0.7 : 1
                        }}
                      >
                        {busyInventoryItemId === item.id ? 'Deactivating\u2026' : 'Deactivate'}
                      </button>
                    )}
                    {canManageInventoryItems && !item.isActive && (
                      <button
                        type="button"
                        onClick={() => void handleReactivate(item.id)}
                        disabled={busyInventoryItemId !== undefined}
                        style={{
                          ...auditGhostButtonStyle,
                          marginLeft: '0.75rem',
                          opacity: busyInventoryItemId === item.id ? 0.7 : 1
                        }}
                      >
                        {busyInventoryItemId === item.id ? 'Reactivating\u2026' : 'Reactivate'}
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
