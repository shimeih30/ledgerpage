import { useEffect, useMemo, useState } from 'react'
import {
  auditBannerStyle,
  auditColors,
  auditFieldErrorTextStyle,
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
import { formatMinorUnitsAsDecimal, parseDecimalToMinorUnits } from './accountingDecimal'
import type { CreateJournalEntryRendererInput, SafeAccount } from '../../../shared/ipc/accounting'

interface ManualJournalEntryScreenProps {
  onCreated: (journalEntryId: string) => void
  onCancel: () => void
}

interface DraftLine {
  key: string
  accountId: string
  debitInput: string
  creditInput: string
  description: string
}

type AccountsLoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; accounts: SafeAccount[] }

let draftLineKeyCounter = 0
function nextDraftLineKey(): string {
  draftLineKeyCounter += 1
  return `draft_line_${draftLineKeyCounter}`
}

function makeEmptyLine(): DraftLine {
  return {
    key: nextDraftLineKey(),
    accountId: '',
    debitInput: '',
    creditInput: '',
    description: ''
  }
}

function todayAsDateInputValue(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface LineValidation {
  accountId: string
  debitMinor: number
  creditMinor: number
  description: string | null
}

/**
 * Validates one draft line in isolation: a real account must be
 * selected, and exactly one of debit/credit must parse to a positive
 * integer minor-unit value via the exact decimal parser (never
 * Number(value) * 100) while the other is blank. Returns undefined for
 * any line that fails this — the caller aggregates per-line validity
 * into the overall submit-disabled state.
 */
function validateLine(line: DraftLine): LineValidation | undefined {
  if (line.accountId.trim().length === 0) {
    return undefined
  }
  const debitTrimmed = line.debitInput.trim()
  const creditTrimmed = line.creditInput.trim()
  const debitProvided = debitTrimmed.length > 0
  const creditProvided = creditTrimmed.length > 0
  if (debitProvided === creditProvided) {
    // Neither side filled, or both sides filled -- exactly one side
    // required.
    return undefined
  }

  const debitMinor = debitProvided ? parseDecimalToMinorUnits(debitTrimmed) : 0
  const creditMinor = creditProvided ? parseDecimalToMinorUnits(creditTrimmed) : 0
  if (debitMinor === undefined || creditMinor === undefined) {
    return undefined
  }
  if (debitProvided && debitMinor <= 0) {
    return undefined
  }
  if (creditProvided && creditMinor <= 0) {
    return undefined
  }

  return {
    accountId: line.accountId,
    debitMinor,
    creditMinor,
    description: line.description.trim().length > 0 ? line.description.trim() : null
  }
}

function fetchActiveAccounts(setState: (next: AccountsLoadState) => void): void {
  window.ledgerpage
    .listAccounts()
    .then((result) => {
      if (!result.success) {
        setState({ kind: 'error' })
        return
      }
      setState({
        kind: 'ready',
        accounts: result.accounts.filter((account) => account.isActive)
      })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

/**
 * Sends only entryDate/description/externalReference/lines, and each
 * line only accountId/debitMinor/creditMinor/description — structurally
 * guaranteed by CreateJournalEntryRendererInput's own shape (no
 * currencyId/entryNumber/createdByUserId/actor/companyId/
 * reversedEntryId field exists on that type to accidentally populate,
 * and no line id/lineOrder field exists on JournalEntryLineRendererInput
 * either). The handler itself computes createdByUserId from the
 * authenticated caller and assigns lineOrder from array order — this
 * screen has no way to override either even if it tried.
 */
export function ManualJournalEntryScreen({ onCreated, onCancel }: ManualJournalEntryScreenProps) {
  const [accountsState, setAccountsState] = useState<AccountsLoadState>({ kind: 'loading' })
  const [entryDate, setEntryDate] = useState(todayAsDateInputValue())
  const [description, setDescription] = useState('')
  const [externalReference, setExternalReference] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([makeEmptyLine(), makeEmptyLine()])
  const [submitError, setSubmitError] = useState<string | undefined>(undefined)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    fetchActiveAccounts(setAccountsState)
  }, [])

  const activeAccounts = accountsState.kind === 'ready' ? accountsState.accounts : []

  const validatedLines = useMemo(() => lines.map(validateLine), [lines])

  const totalDebitMinor = useMemo(
    () => validatedLines.reduce((sum, line) => sum + (line?.debitMinor ?? 0), 0),
    [validatedLines]
  )
  const totalCreditMinor = useMemo(
    () => validatedLines.reduce((sum, line) => sum + (line?.creditMinor ?? 0), 0),
    [validatedLines]
  )

  const everyLineValid = validatedLines.every((line) => line !== undefined)
  const isBalanced = totalDebitMinor === totalCreditMinor && totalDebitMinor > 0
  const descriptionValid = description.trim().length > 0
  const entryDateValid = entryDate.trim().length > 0
  const canSubmit =
    everyLineValid && isBalanced && descriptionValid && entryDateValid && lines.length >= 2

  function updateLine(key: string, patch: Partial<DraftLine>): void {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  function addLine(): void {
    setLines((current) => [...current, makeEmptyLine()])
  }

  function removeLine(key: string): void {
    setLines((current) => (current.length <= 2 ? current : current.filter((l) => l.key !== key)))
  }

  async function handleSubmit(): Promise<void> {
    if (isSubmitting || !canSubmit) {
      return
    }
    setIsSubmitting(true)
    setSubmitError(undefined)
    try {
      const input: CreateJournalEntryRendererInput = {
        entryDate: new Date(entryDate).getTime(),
        description,
        externalReference: externalReference.trim().length > 0 ? externalReference : null,
        lines: validatedLines
          .filter((line): line is LineValidation => line !== undefined)
          .map((line) => ({
            accountId: line.accountId,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            description: line.description
          }))
      }
      const result = await window.ledgerpage.createJournalEntry(input)
      if (!result.success) {
        setSubmitError(describeJournalError(result.errorCode))
        return
      }
      onCreated(result.entry.id)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>New Manual Journal</h1>
        <button type="button" onClick={onCancel} style={auditGhostButtonStyle}>
          Back
        </button>
      </div>

      {accountsState.kind === 'error' && (
        <div style={auditBannerStyle}>Couldn&rsquo;t load accounts. Try reloading the app.</div>
      )}

      <div style={auditPanelStyle}>
        <div style={auditFieldGroupStyle}>
          <label htmlFor="entry-date" style={auditLabelStyle}>
            Entry date
          </label>
          <input
            id="entry-date"
            type="date"
            value={entryDate}
            onChange={(event) => setEntryDate(event.target.value)}
            style={auditFieldStyle()}
          />
        </div>
        <div style={auditFieldGroupStyle}>
          <label htmlFor="entry-description" style={auditLabelStyle}>
            Description
          </label>
          <input
            id="entry-description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            style={auditFieldStyle()}
          />
        </div>
        <div style={auditFieldGroupStyle}>
          <label htmlFor="entry-external-reference" style={auditLabelStyle}>
            External reference (optional)
          </label>
          <input
            id="entry-external-reference"
            type="text"
            value={externalReference}
            onChange={(event) => setExternalReference(event.target.value)}
            style={auditFieldStyle()}
          />
        </div>

        <h2 style={{ ...auditHeadingStyle, fontSize: '1rem', marginTop: '1rem' }}>Lines</h2>
        {lines.map((line, index) => (
          <div
            key={line.key}
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'flex-end',
              marginBottom: '0.5rem'
            }}
          >
            <div style={{ ...auditFieldGroupStyle, flex: 2 }}>
              <label htmlFor={`line-account-${line.key}`} style={auditLabelStyle}>
                Account
              </label>
              <select
                id={`line-account-${line.key}`}
                value={line.accountId}
                onChange={(event) => updateLine(line.key, { accountId: event.target.value })}
                style={auditFieldStyle()}
              >
                <option value="">Select an account&hellip;</option>
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {`${account.code} \u2013 ${account.name}`}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ ...auditFieldGroupStyle, flex: 1 }}>
              <label htmlFor={`line-debit-${line.key}`} style={auditLabelStyle}>
                Debit
              </label>
              <input
                id={`line-debit-${line.key}`}
                type="text"
                inputMode="decimal"
                value={line.debitInput}
                onChange={(event) => updateLine(line.key, { debitInput: event.target.value })}
                style={auditFieldStyle()}
              />
            </div>
            <div style={{ ...auditFieldGroupStyle, flex: 1 }}>
              <label htmlFor={`line-credit-${line.key}`} style={auditLabelStyle}>
                Credit
              </label>
              <input
                id={`line-credit-${line.key}`}
                type="text"
                inputMode="decimal"
                value={line.creditInput}
                onChange={(event) => updateLine(line.key, { creditInput: event.target.value })}
                style={auditFieldStyle()}
              />
            </div>
            <div style={{ ...auditFieldGroupStyle, flex: 2 }}>
              <label htmlFor={`line-description-${line.key}`} style={auditLabelStyle}>
                Description (optional)
              </label>
              <input
                id={`line-description-${line.key}`}
                type="text"
                value={line.description}
                onChange={(event) => updateLine(line.key, { description: event.target.value })}
                style={auditFieldStyle()}
              />
            </div>
            <button
              type="button"
              onClick={() => removeLine(line.key)}
              disabled={lines.length <= 2}
              style={auditGhostButtonStyle}
              aria-label={`Remove line ${index + 1}`}
            >
              Remove line
            </button>
          </div>
        ))}
        <button type="button" onClick={addLine} style={auditGhostButtonStyle}>
          Add line
        </button>

        <div style={{ marginTop: '1rem', fontSize: '0.8125rem' }}>
          <p>{`Total debit: ${formatMinorUnitsAsDecimal(totalDebitMinor)}`}</p>
          <p>{`Total credit: ${formatMinorUnitsAsDecimal(totalCreditMinor)}`}</p>
          <p style={{ color: isBalanced ? auditColors.mutedInk : '#7A241D', fontWeight: 600 }}>
            {isBalanced ? 'Balanced' : 'Out of balance'}
          </p>
        </div>

        {submitError && <p style={auditFieldErrorTextStyle}>{submitError}</p>}

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit || isSubmitting}
          style={auditPrimaryButtonStyle}
        >
          Post journal entry
        </button>
      </div>
    </div>
  )
}

function describeJournalError(errorCode: string): string {
  switch (errorCode) {
    case 'unbalanced_entry':
      return 'Total debits must equal total credits.'
    case 'inactive_account':
      return 'One of the selected accounts is no longer active.'
    case 'invalid_input':
      return 'Please check the values entered and try again.'
    case 'not_authorized':
      return 'You do not have permission to do this.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
