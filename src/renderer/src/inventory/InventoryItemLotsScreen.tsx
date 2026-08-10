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
  auditTableStyle
} from '../shared/ui'
import type { SafeInventoryLot } from '../../../shared/ipc/inventoryLots'

interface InventoryItemLotsScreenProps {
  inventoryItemId: string
  itemCode: string
  itemName: string
  onBack: () => void
  onOpenLot: (lotId: string) => void
}

type LoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; lots: SafeInventoryLot[] }

function fetchLots(inventoryItemId: string, setState: (next: LoadState) => void): void {
  window.ledgerpage
    .listInventoryLotsForItem({ inventoryItemId })
    .then((result) => {
      if (!result.success) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', lots: result.lots })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

function statusBadgeStyle(effectiveStatus: SafeInventoryLot['effectiveStatus']) {
  const colorsByStatus: Record<
    SafeInventoryLot['effectiveStatus'],
    { backgroundColor: string; color: string }
  > = {
    active: { backgroundColor: '#EAF3DE', color: '#27500A' },
    quarantined: { backgroundColor: '#FAEEDA', color: '#633806' },
    expired: { backgroundColor: '#FBE2E1', color: '#7A241D' },
    depleted: { backgroundColor: '#E9E9EC', color: '#3F3F46' }
  }
  return {
    display: 'inline-block' as const,
    fontSize: '0.6875rem',
    fontWeight: 600,
    padding: '0.125rem 0.4375rem',
    borderRadius: '4px',
    ...colorsByStatus[effectiveStatus]
  }
}

function formatDate(timestampMs: number): string {
  return new Intl.DateTimeFormat('en-ZW', { dateStyle: 'medium' }).format(new Date(timestampMs))
}

/**
 * Entirely read-only — calls listInventoryLotsForItem exactly once
 * per mount and renders every lot returned for the selected item,
 * preserving the exact order the IPC call returns (FIFO order, per
 * the service layer) rather than re-sorting client-side. This screen
 * exists specifically so a reader can see every lot for an item and
 * choose which one to open, rather than StockOnHandScreen silently
 * guessing which lot they meant whenever more than one exists. No
 * create/edit/adjustment/reversal/quarantine control exists here.
 */
export function InventoryItemLotsScreen({
  inventoryItemId,
  itemCode,
  itemName,
  onBack,
  onOpenLot
}: InventoryItemLotsScreenProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    fetchLots(inventoryItemId, setState)
  }, [inventoryItemId])

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>
          {itemCode} &ndash; {itemName}
        </h1>
        <button type="button" onClick={onBack} style={auditGhostButtonStyle}>
          Back
        </button>
      </div>

      {state.kind === 'loading' && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      )}

      {state.kind === 'error' && (
        <div style={auditBannerStyle}>
          Couldn&rsquo;t load lots for this item. Try reloading the app.
        </div>
      )}

      {state.kind === 'ready' && state.lots.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>
          No lots recorded for this item yet.
        </p>
      )}

      {state.kind === 'ready' && state.lots.length > 0 && (
        <div style={auditPanelStyle}>
          <table style={auditTableStyle}>
            <thead>
              <tr style={auditHeaderRowStyle}>
                <th style={auditHeaderCellStyle}>Internal lot #</th>
                <th style={auditHeaderCellStyle}>Supplier lot #</th>
                <th style={auditHeaderCellStyle}>Received</th>
                <th style={auditHeaderCellStyle}>Qty received</th>
                <th style={auditHeaderCellStyle}>Qty remaining</th>
                <th style={auditHeaderCellStyle}>Status</th>
                <th style={auditHeaderCellStyle}>Expiry</th>
                <th style={auditHeaderCellStyle}>Supplier</th>
                <th style={auditHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.lots.map((lot, index) => (
                <tr
                  key={lot.id}
                  style={{
                    borderBottom:
                      index === state.lots.length - 1 ? 'none' : `1px solid ${auditColors.border}`
                  }}
                >
                  <td style={{ ...auditBodyCellStyle, fontFamily: 'ui-monospace, monospace' }}>
                    {lot.internalLotNumber}
                  </td>
                  <td style={auditBodyCellStyle}>{lot.supplierLotNumber ?? '\u2014'}</td>
                  <td style={auditBodyCellStyle}>{formatDate(lot.receivedDate)}</td>
                  <td style={auditBodyCellStyle}>{lot.formattedQuantityReceived}</td>
                  <td style={auditBodyCellStyle}>{lot.formattedQuantityRemaining}</td>
                  <td style={auditBodyCellStyle}>
                    <span style={statusBadgeStyle(lot.effectiveStatus)}>{lot.effectiveStatus}</span>
                  </td>
                  <td style={auditBodyCellStyle}>
                    {lot.expiryDate !== null ? formatDate(lot.expiryDate) : '\u2014'}
                  </td>
                  <td style={auditBodyCellStyle}>{lot.supplierName ?? '\u2014'}</td>
                  <td style={auditBodyCellStyle}>
                    <button
                      type="button"
                      onClick={() => onOpenLot(lot.id)}
                      style={auditGhostButtonStyle}
                    >
                      View
                    </button>
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
