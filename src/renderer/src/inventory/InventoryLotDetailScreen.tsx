import { useEffect, useState } from 'react'
import {
  auditBannerStyle,
  auditColors,
  auditFilterBarStyle,
  auditGhostButtonStyle,
  auditHeadingStyle,
  auditLabelStyle,
  auditPageStyle,
  auditPanelStyle
} from '../shared/ui'
import type { SafeInventoryLot, SafeStockMovement } from '../../../shared/ipc/inventoryLots'

interface InventoryLotDetailScreenProps {
  lotId: string
  onBack: () => void
}

type LotState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; lot: SafeInventoryLot }

/**
 * Formats an integer minor-currency-units value using en-ZW number/
 * currency presentation conventions (approved decision), while
 * preserving the functional currency already stored by the app --
 * this never converts currency, it only changes how the same USD
 * value is displayed (e.g. "US$70.00" rather than "$70.00").
 * FUNCTIONAL_CURRENCY_ID is always 'currency_usd' in this codebase, so
 * 'USD' is used directly as the ISO code Intl.NumberFormat expects.
 */
function formatMoneyMinorAsEnZwCurrency(minorUnits: number): string {
  return new Intl.NumberFormat('en-ZW', { style: 'currency', currency: 'USD' }).format(
    minorUnits / 100
  )
}

function formatDate(timestampMs: number): string {
  return new Intl.DateTimeFormat('en-ZW', { dateStyle: 'medium' }).format(new Date(timestampMs))
}

function formatDateTime(timestampMs: number): string {
  return new Intl.DateTimeFormat('en-ZW', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(timestampMs)
  )
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

async function loadLot(lotId: string, setState: (next: LotState) => void): Promise<void> {
  try {
    const result = await window.ledgerpage.getInventoryLot({ lotId })
    if (!result.success) {
      setState({ kind: 'error' })
      return
    }
    setState({ kind: 'ready', lot: result.lot })
  } catch {
    setState({ kind: 'error' })
  }
}

/**
 * Entirely read-only — no edit/delete/reverse/quarantine/activate
 * control exists anywhere on this screen, and this file calls only
 * getInventoryLot and listInventoryLotMovements, never any of the
 * internal mutation services (createOpeningLot, recordAdjustment,
 * reserveStock, releaseReservation, reverseMovement, consumeStock,
 * setLotQuarantined, setLotActive), none of which are even exposed
 * over IPC in this slice. Movement rows are rendered in exactly the
 * order returned by listInventoryLotMovements (append-only,
 * chronological) — never re-sorted or filtered client-side.
 */
export function InventoryLotDetailScreen({ lotId, onBack }: InventoryLotDetailScreenProps) {
  const [state, setState] = useState<LotState>({ kind: 'loading' })
  const [movements, setMovements] = useState<SafeStockMovement[]>([])
  const [movementsError, setMovementsError] = useState<string | undefined>(undefined)

  useEffect(() => {
    void loadLot(lotId, setState)
    window.ledgerpage
      .listInventoryLotMovements({ lotId })
      .then((result) => {
        if (!result.success) {
          setMovementsError('Couldn\u2019t load the movement history.')
          return
        }
        setMovementsError(undefined)
        setMovements(result.movements)
      })
      .catch(() => {
        setMovementsError('Couldn\u2019t load the movement history.')
      })
  }, [lotId])

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
        <div style={auditBannerStyle}>Couldn&rsquo;t load this lot. Try reloading the app.</div>
      </div>
    )
  }

  const { lot } = state

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>{lot.internalLotNumber}</h1>
        <button type="button" onClick={onBack} style={auditGhostButtonStyle}>
          Back
        </button>
      </div>

      <div style={auditPanelStyle}>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <span style={auditLabelStyle}>Internal lot number</span>
              <div style={{ fontFamily: 'ui-monospace, monospace' }}>{lot.internalLotNumber}</div>
            </div>
            <div>
              <span style={auditLabelStyle}>Supplier lot number</span>
              <div>{lot.supplierLotNumber ?? '\u2014'}</div>
            </div>
            <div>
              <span style={auditLabelStyle}>Status</span>
              <div style={{ marginTop: '0.125rem' }}>
                <span style={statusBadgeStyle(lot.effectiveStatus)}>{lot.effectiveStatus}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <span style={auditLabelStyle}>Item</span>
              <div>
                {lot.itemCode} &ndash; {lot.itemName}
              </div>
            </div>
            <div>
              <span style={auditLabelStyle}>Supplier</span>
              <div>
                {lot.supplierCode && lot.supplierName
                  ? `${lot.supplierCode} \u2013 ${lot.supplierName}`
                  : '\u2014'}
              </div>
            </div>
            <div>
              <span style={auditLabelStyle}>Received date</span>
              <div>{formatDate(lot.receivedDate)}</div>
            </div>
            <div>
              <span style={auditLabelStyle}>Expiry date</span>
              <div>{lot.expiryDate !== null ? formatDate(lot.expiryDate) : '\u2014'}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <span style={auditLabelStyle}>Quantity received</span>
              <div>
                {lot.formattedQuantityReceived} {lot.unitCode}
              </div>
            </div>
            <div>
              <span style={auditLabelStyle}>Quantity remaining</span>
              <div>
                {lot.formattedQuantityRemaining} {lot.unitCode}
              </div>
            </div>
            <div>
              <span style={auditLabelStyle}>Base unit</span>
              <div>
                {lot.unitCode} &ndash; {lot.unitName}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <span style={auditLabelStyle}>Unit cost</span>
              <div>{formatMoneyMinorAsEnZwCurrency(lot.unitCostMinor)}</div>
            </div>
            <div>
              <span style={auditLabelStyle}>Total cost</span>
              <div>{formatMoneyMinorAsEnZwCurrency(lot.totalCostMinor)}</div>
            </div>
            <div>
              <span style={auditLabelStyle}>Remaining cost</span>
              <div>{formatMoneyMinorAsEnZwCurrency(lot.costRemainingMinor)}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <span style={auditLabelStyle}>Created</span>
              <div style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>
                {formatDateTime(lot.createdAt)}
              </div>
            </div>
            <div>
              <span style={auditLabelStyle}>Updated</span>
              <div style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>
                {formatDateTime(lot.updatedAt)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={auditPanelStyle}>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h2 style={{ ...auditHeadingStyle, fontSize: '1.0625rem', margin: 0 }}>
            Movement history
          </h2>

          {movementsError && <div style={auditBannerStyle}>{movementsError}</div>}

          {movements.length === 0 && !movementsError && (
            <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem', margin: 0 }}>
              No movements recorded yet.
            </p>
          )}

          {movements.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: auditColors.mutedInk }}>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Type</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Physical</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Reserved</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Cost</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Reference</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Reversal of</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Reason</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id} style={{ borderTop: `1px solid ${auditColors.border}` }}>
                    <td style={{ padding: '0.375rem 0.5rem' }}>{movement.movementType}</td>
                    <td style={{ padding: '0.375rem 0.5rem' }}>
                      {movement.formattedPhysicalQuantityDelta}
                    </td>
                    <td style={{ padding: '0.375rem 0.5rem' }}>
                      {movement.formattedReservedQuantityDelta}
                    </td>
                    <td style={{ padding: '0.375rem 0.5rem' }}>
                      {formatMoneyMinorAsEnZwCurrency(movement.costDeltaMinor)}
                    </td>
                    <td style={{ padding: '0.375rem 0.5rem' }}>
                      {movement.referenceType}
                      {movement.referenceId ? ` (${movement.referenceId})` : ''}
                    </td>
                    <td
                      style={{ padding: '0.375rem 0.5rem', fontFamily: 'ui-monospace, monospace' }}
                    >
                      {movement.reversedMovementId ?? '\u2014'}
                    </td>
                    <td style={{ padding: '0.375rem 0.5rem' }}>{movement.reason ?? '\u2014'}</td>
                    <td style={{ padding: '0.375rem 0.5rem' }}>
                      {formatDateTime(movement.createdAt)}
                    </td>
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
