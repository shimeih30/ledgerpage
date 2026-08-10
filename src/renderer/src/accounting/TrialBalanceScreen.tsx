import { useEffect, useState } from 'react'
import {
  auditBannerStyle,
  auditBodyCellStyle,
  auditColors,
  auditFilterBarStyle,
  auditHeaderCellStyle,
  auditHeaderRowStyle,
  auditHeadingStyle,
  auditPageStyle,
  auditPanelStyle,
  auditTableStyle
} from '../shared/ui'
import { formatMinorUnitsAsDecimal } from './accountingDecimal'
import type { SafeTrialBalance } from '../../../shared/ipc/accounting'

type LoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; trialBalance: SafeTrialBalance }

function fetchTrialBalance(setState: (next: LoadState) => void): void {
  window.ledgerpage
    .getTrialBalance()
    .then((result) => {
      if (!result.success) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', trialBalance: result.trialBalance })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

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
 * Entirely read-only — no mutation control of any kind, and
 * deliberately no date picker or accounting-period selector anywhere
 * on this screen: getTrialBalance's own IPC contract has no such
 * parameter, since Slice 16's approved scope is a single, all-time
 * balance as of right now, not a date-ranged report.
 */
export function TrialBalanceScreen() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    fetchTrialBalance(setState)
  }, [])

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>Trial Balance</h1>
      </div>

      {state.kind === 'loading' && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      )}

      {state.kind === 'error' && (
        <div style={auditBannerStyle}>
          Couldn&rsquo;t load the trial balance. Try reloading the app.
        </div>
      )}

      {state.kind === 'ready' && (
        <div style={auditPanelStyle}>
          <table style={auditTableStyle}>
            <thead>
              <tr style={auditHeaderRowStyle}>
                <th style={auditHeaderCellStyle}>Code</th>
                <th style={auditHeaderCellStyle}>Account</th>
                <th style={auditHeaderCellStyle}>Category</th>
                <th style={auditHeaderCellStyle}>Normal balance</th>
                <th style={auditHeaderCellStyle}>Total debit</th>
                <th style={auditHeaderCellStyle}>Total credit</th>
                <th style={auditHeaderCellStyle}>Closing debit</th>
                <th style={auditHeaderCellStyle}>Closing credit</th>
                <th style={auditHeaderCellStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.trialBalance.accounts.map((row) => (
                <tr key={row.id}>
                  <td style={{ ...auditBodyCellStyle, fontFamily: 'ui-monospace, monospace' }}>
                    {row.code}
                  </td>
                  <td style={auditBodyCellStyle}>{row.name}</td>
                  <td style={auditBodyCellStyle}>{row.category}</td>
                  <td style={auditBodyCellStyle}>{row.normalBalance}</td>
                  <td style={auditBodyCellStyle}>
                    {formatMinorUnitsAsDecimal(row.totalDebitMinor)}
                  </td>
                  <td style={auditBodyCellStyle}>
                    {formatMinorUnitsAsDecimal(row.totalCreditMinor)}
                  </td>
                  <td style={auditBodyCellStyle}>
                    {formatMinorUnitsAsDecimal(row.closingDebitMinor)}
                  </td>
                  <td style={auditBodyCellStyle}>
                    {formatMinorUnitsAsDecimal(row.closingCreditMinor)}
                  </td>
                  <td style={auditBodyCellStyle}>
                    <span style={statusBadgeStyle(row.isActive)}>
                      {row.isActive ? 'active' : 'inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, borderTop: `2px solid ${auditColors.border}` }}>
                <td style={auditBodyCellStyle} colSpan={4}>
                  Grand total
                </td>
                <td style={auditBodyCellStyle}>
                  {formatMinorUnitsAsDecimal(state.trialBalance.grandTotalDebitMinor)}
                </td>
                <td style={auditBodyCellStyle}>
                  {formatMinorUnitsAsDecimal(state.trialBalance.grandTotalCreditMinor)}
                </td>
                <td style={auditBodyCellStyle} colSpan={3}>
                  {state.trialBalance.isBalanced ? 'Balanced' : 'Out of balance'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
