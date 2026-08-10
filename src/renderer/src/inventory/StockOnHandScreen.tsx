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
  auditTableStyle
} from '../shared/ui'
import type { SafeStockSummary } from '../../../shared/ipc/inventoryLots'

interface StockOnHandScreenProps {
  onOpenItemLots: (inventoryItemId: string, itemCode: string, itemName: string) => void
}

type LoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; summaries: SafeStockSummary[] }

function fetchSummaries(setState: (next: LoadState) => void): void {
  window.ledgerpage
    .listStockSummaries()
    .then((result) => {
      if (!result.success) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', summaries: result.summaries })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

/**
 * Client-side, case-insensitive search over item code/name only,
 * mirroring CustomerListScreen's own established search pattern for
 * this codebase — no server-side search, pagination, or dedicated
 * search IPC channel.
 */
function matchesSearch(summary: SafeStockSummary, query: string): boolean {
  if (query === '') {
    return true
  }
  const needle = query.toLowerCase()
  return (
    summary.itemCode.toLowerCase().includes(needle) ||
    summary.itemName.toLowerCase().includes(needle)
  )
}

/**
 * Entirely read-only, per this slice's own approved architecture —
 * there is no create/adjustment/receipt/reservation/release/
 * consumption control anywhere on this screen, and no mutation IPC
 * method exists for it to call even if one were added by mistake
 * (registerInventoryLotHandlers.ts registers only 5 read channels,
 * confirmed by its own structural tests).
 *
 * This screen calls only listStockSummaries — never
 * listInventoryLotsForItem. A stock summary row represents an item,
 * potentially with several lots, so opening a row navigates to that
 * item's own lot list (InventoryItemLotsScreen) rather than silently
 * picking one lot to show — which lot the reader actually wants is
 * ambiguous whenever more than one exists, so this screen never
 * guesses. Navigation here is a synchronous local state change, not
 * an IPC call, so no busy-state or duplicate-click guard is needed.
 */
export function StockOnHandScreen({ onOpenItemLots }: StockOnHandScreenProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    fetchSummaries(setState)
  }, [])

  const filteredSummaries = useMemo(() => {
    if (state.kind !== 'ready') {
      return []
    }
    return state.summaries.filter((summary) => matchesSearch(summary, searchQuery))
  }, [state, searchQuery])

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>Stock on Hand</h1>
      </div>

      {state.kind === 'ready' && state.summaries.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <label htmlFor="stock-search" style={{ display: 'none' }}>
            Search stock
          </label>
          <input
            id="stock-search"
            type="text"
            placeholder="Search by item code or name…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            style={{ ...auditFieldStyle(), maxWidth: '24rem' }}
          />
        </div>
      )}

      {state.kind === 'loading' && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      )}

      {state.kind === 'error' && (
        <div style={auditBannerStyle}>
          Couldn&rsquo;t load stock on hand. Try reloading the app.
        </div>
      )}

      {state.kind === 'ready' && state.summaries.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>No stock on hand yet.</p>
      )}

      {state.kind === 'ready' && state.summaries.length > 0 && filteredSummaries.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>
          No items match &ldquo;{searchQuery}&rdquo;.
        </p>
      )}

      {state.kind === 'ready' && filteredSummaries.length > 0 && (
        <div style={auditPanelStyle}>
          <table style={auditTableStyle}>
            <thead>
              <tr style={auditHeaderRowStyle}>
                <th style={auditHeaderCellStyle}>Code</th>
                <th style={auditHeaderCellStyle}>Name</th>
                <th style={auditHeaderCellStyle}>Unit</th>
                <th style={auditHeaderCellStyle}>Physical</th>
                <th style={auditHeaderCellStyle}>Reserved</th>
                <th style={auditHeaderCellStyle}>Available</th>
                <th style={auditHeaderCellStyle}>Incoming</th>
                <th style={auditHeaderCellStyle}>Lots</th>
                <th style={auditHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSummaries.map((summary, index) => (
                <tr
                  key={summary.inventoryItemId}
                  style={{
                    borderBottom:
                      index === filteredSummaries.length - 1
                        ? 'none'
                        : `1px solid ${auditColors.border}`
                  }}
                >
                  <td style={{ ...auditBodyCellStyle, fontFamily: 'ui-monospace, monospace' }}>
                    {summary.itemCode}
                  </td>
                  <td style={auditBodyCellStyle}>{summary.itemName}</td>
                  <td style={auditBodyCellStyle}>{summary.unitCode}</td>
                  <td style={auditBodyCellStyle}>{summary.formattedPhysicalQuantity}</td>
                  <td style={auditBodyCellStyle}>{summary.formattedReservedQuantity}</td>
                  <td style={auditBodyCellStyle}>{summary.formattedAvailableQuantity}</td>
                  <td style={auditBodyCellStyle}>{summary.formattedIncomingQuantity}</td>
                  <td style={auditBodyCellStyle}>{summary.lotCount}</td>
                  <td style={auditBodyCellStyle}>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenItemLots(summary.inventoryItemId, summary.itemCode, summary.itemName)
                      }
                      style={auditGhostButtonStyle}
                    >
                      View lots
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
