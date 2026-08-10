import { useEffect, useState } from 'react'
import {
  auditBannerStyle,
  auditBodyCellStyle,
  auditColors,
  auditFieldErrorTextStyle,
  auditFieldGroupStyle,
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
import { formatMinorUnitsAsDecimal } from './accountingDecimal'
import type { SafeJournalEntry } from '../../../shared/ipc/accounting'

interface JournalEntryDetailScreenProps {
  journalEntryId: string
  canManageJournalEntries: boolean
  onReversed: (reversalEntryId: string) => void
  onBack: () => void
}

type LoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; entry: SafeJournalEntry }

function fetchJournalEntry(journalEntryId: string, setState: (next: LoadState) => void): void {
  window.ledgerpage
    .getJournalEntry({ id: journalEntryId })
    .then((result) => {
      if (!result.success) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', entry: result.entry })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

function formatDate(timestampMs: number): string {
  return new Intl.DateTimeFormat('en-ZW', { dateStyle: 'medium' }).format(new Date(timestampMs))
}

/**
 * "USD presentation only" -- this screen always labels amounts with a
 * literal "USD", never resolving or displaying the raw currencyId
 * value, and never performing any conversion (the stored currency is
 * always FUNCTIONAL_CURRENCY_ID/USD in this slice; there is nothing to
 * convert).
 */
function formatUsd(minorUnits: number): string {
  return `USD ${formatMinorUnitsAsDecimal(minorUnits)}`
}

/**
 * Entirely read-only for the entry itself and every one of its lines —
 * no edit, no delete, no line edit, no line delete control exists
 * anywhere on this screen. The only mutation this screen ever offers is
 * a brand-new reversal entry, and even that is gated on three
 * independent conditions, all read directly from the server's own safe
 * response rather than inferred: canManageJournalEntries (role),
 * entry.reversedEntryId === null (this entry is not itself a
 * reversal), and entry.hasBeenReversed === false (nothing has reversed
 * this entry yet) -- hasBeenReversed is a dedicated, narrowly-added
 * field on SafeJournalEntry precisely because the renderer must never
 * guess this from a partial view of the data.
 */
export function JournalEntryDetailScreen({
  journalEntryId,
  canManageJournalEntries,
  onReversed,
  onBack
}: JournalEntryDetailScreenProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [showReversalForm, setShowReversalForm] = useState(false)
  const [reversalReason, setReversalReason] = useState('')
  const [reversalError, setReversalError] = useState<string | undefined>(undefined)
  const [isReversing, setIsReversing] = useState(false)

  useEffect(() => {
    fetchJournalEntry(journalEntryId, setState)
  }, [journalEntryId])

  async function handleReversalSubmit(): Promise<void> {
    if (isReversing || reversalReason.trim().length === 0) {
      return
    }
    setIsReversing(true)
    setReversalError(undefined)
    try {
      const result = await window.ledgerpage.reverseJournalEntry({
        journalEntryId,
        reversalReason
      })
      if (!result.success) {
        setReversalError(describeReversalError(result.errorCode))
        return
      }
      onReversed(result.entry.id)
    } finally {
      setIsReversing(false)
    }
  }

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>Journal Entry</h1>
        <button type="button" onClick={onBack} style={auditGhostButtonStyle}>
          Back
        </button>
      </div>

      {state.kind === 'loading' && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      )}

      {state.kind === 'error' && (
        <div style={auditBannerStyle}>
          Couldn&rsquo;t load this journal entry. Try reloading the app.
        </div>
      )}

      {state.kind === 'ready' && (
        <>
          <div style={auditPanelStyle}>
            <p>
              <strong>{state.entry.entryNumber}</strong>
            </p>
            <p>{formatDate(state.entry.entryDate)}</p>
            <p>{state.entry.description}</p>
            <p>{`Reference: ${state.entry.externalReference ?? '\u2014'}`}</p>
            <p>{`Created by: ${state.entry.createdByLabel ?? '\u2014'}`}</p>
            <p>Currency: USD</p>
            {state.entry.reversedEntryId !== null && (
              <p>{`This entry is a reversal of ${state.entry.reversedEntryId}`}</p>
            )}
            {state.entry.reversalReason !== null && (
              <p>{`Reversal reason: ${state.entry.reversalReason}`}</p>
            )}
          </div>

          <div style={auditPanelStyle}>
            <table style={auditTableStyle}>
              <thead>
                <tr style={auditHeaderRowStyle}>
                  <th style={auditHeaderCellStyle}>#</th>
                  <th style={auditHeaderCellStyle}>Account</th>
                  <th style={auditHeaderCellStyle}>Description</th>
                  <th style={auditHeaderCellStyle}>Debit</th>
                  <th style={auditHeaderCellStyle}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {state.entry.lines.map((line, index) => (
                  <tr key={line.id}>
                    <td style={auditBodyCellStyle}>{index + 1}</td>
                    <td style={auditBodyCellStyle}>
                      {`${line.accountCode} \u2013 ${line.accountName}`}
                    </td>
                    <td style={auditBodyCellStyle}>{line.description ?? '\u2014'}</td>
                    <td style={auditBodyCellStyle}>
                      {line.debitMinor > 0 ? formatUsd(line.debitMinor) : ''}
                    </td>
                    <td style={auditBodyCellStyle}>
                      {line.creditMinor > 0 ? formatUsd(line.creditMinor) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(() => {
              const totalDebit = state.entry.lines.reduce((sum, l) => sum + l.debitMinor, 0)
              const totalCredit = state.entry.lines.reduce((sum, l) => sum + l.creditMinor, 0)
              return (
                <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem' }}>
                  {`Totals: ${formatUsd(totalDebit)} / ${formatUsd(totalCredit)} \u2014 ${
                    totalDebit === totalCredit ? 'Balanced' : 'Out of balance'
                  }`}
                </p>
              )
            })()}
          </div>

          {canManageJournalEntries &&
            state.entry.reversedEntryId === null &&
            !state.entry.hasBeenReversed && (
              <div style={auditPanelStyle}>
                {!showReversalForm && (
                  <button
                    type="button"
                    onClick={() => setShowReversalForm(true)}
                    style={auditGhostButtonStyle}
                  >
                    Reverse entry
                  </button>
                )}
                {showReversalForm && (
                  <div style={auditFieldGroupStyle}>
                    <label htmlFor="reversal-reason">Reversal reason</label>
                    <input
                      id="reversal-reason"
                      type="text"
                      value={reversalReason}
                      onChange={(event) => setReversalReason(event.target.value)}
                      style={auditFieldStyle()}
                    />
                    {reversalError && <p style={auditFieldErrorTextStyle}>{reversalError}</p>}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() => void handleReversalSubmit()}
                        disabled={isReversing || reversalReason.trim().length === 0}
                        style={auditPrimaryButtonStyle}
                      >
                        Confirm reversal
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowReversalForm(false)
                          setReversalReason('')
                          setReversalError(undefined)
                        }}
                        style={auditGhostButtonStyle}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
        </>
      )}
    </div>
  )
}

function describeReversalError(errorCode: string): string {
  switch (errorCode) {
    case 'already_reversed':
      return 'This entry has already been reversed.'
    case 'reversal_of_reversal':
      return 'A reversal entry cannot itself be reversed.'
    case 'invalid_input':
      return 'A reversal reason is required.'
    case 'not_authorized':
      return 'You do not have permission to do this.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
