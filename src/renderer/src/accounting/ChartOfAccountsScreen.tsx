import { useEffect, useMemo, useState } from 'react'
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
  auditLabelStyle,
  auditPageStyle,
  auditPanelStyle,
  auditPrimaryButtonStyle,
  auditTableStyle
} from '../shared/ui'
import type {
  AccountCategory,
  CreateAccountRendererInput,
  SafeAccount,
  UpdateAccountRendererInput
} from '../../../shared/ipc/accounting'

interface ChartOfAccountsScreenProps {
  canManageAccounts: boolean
}

type LoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; accounts: SafeAccount[] }

type FormMode = { kind: 'none' } | { kind: 'creating' } | { kind: 'editing'; accountId: string }

const ACCOUNT_CATEGORIES: readonly AccountCategory[] = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'cost_of_goods_sold',
  'expense'
]

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

function fetchAccounts(setState: (next: LoadState) => void): void {
  window.ledgerpage
    .listAccounts()
    .then((result) => {
      if (!result.success) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', accounts: result.accounts })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

/**
 * Client-side, case-insensitive search over code/name/subtype only —
 * mirroring CustomerListScreen's own established search pattern.
 */
function matchesSearch(account: SafeAccount, query: string): boolean {
  if (query === '') {
    return true
  }
  const needle = query.toLowerCase()
  return (
    account.code.toLowerCase().includes(needle) ||
    account.name.toLowerCase().includes(needle) ||
    (account.subtype ?? '').toLowerCase().includes(needle)
  )
}

/**
 * Never applies an optimistic update to local state on any mutation —
 * every create/update/deactivate/reactivate re-fetches listAccounts
 * afterward, so the displayed list always reflects the server's own
 * authoritative response, never a locally-guessed shape.
 */
export function ChartOfAccountsScreen({ canManageAccounts }: ChartOfAccountsScreenProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [searchQuery, setSearchQuery] = useState('')
  const [formMode, setFormMode] = useState<FormMode>({ kind: 'none' })
  const [formCode, setFormCode] = useState('')
  const [formName, setFormName] = useState('')
  const [formCategory, setFormCategory] = useState<AccountCategory>('asset')
  const [formSubtype, setFormSubtype] = useState('')
  const [formError, setFormError] = useState<string | undefined>(undefined)
  const [isSaving, setIsSaving] = useState(false)
  const [busyAccountId, setBusyAccountId] = useState<string | undefined>(undefined)

  useEffect(() => {
    fetchAccounts(setState)
  }, [])

  const accounts = useMemo(() => (state.kind === 'ready' ? state.accounts : []), [state])

  const filteredAccounts = useMemo(
    () => accounts.filter((account) => matchesSearch(account, searchQuery)),
    [accounts, searchQuery]
  )

  function openCreateForm(): void {
    setFormMode({ kind: 'creating' })
    setFormCode('')
    setFormName('')
    setFormCategory('asset')
    setFormSubtype('')
    setFormError(undefined)
  }

  function openEditForm(account: SafeAccount): void {
    setFormMode({ kind: 'editing', accountId: account.id })
    setFormName(account.name)
    setFormSubtype(account.subtype ?? '')
    setFormError(undefined)
  }

  function closeForm(): void {
    setFormMode({ kind: 'none' })
    setFormError(undefined)
  }

  async function handleCreateSubmit(): Promise<void> {
    if (isSaving) {
      return
    }
    setIsSaving(true)
    setFormError(undefined)
    try {
      const input: CreateAccountRendererInput = {
        code: formCode,
        name: formName,
        category: formCategory,
        subtype: formSubtype.trim().length > 0 ? formSubtype : null
      }
      const result = await window.ledgerpage.createAccount(input)
      if (!result.success) {
        setFormError(describeAccountError(result.errorCode))
        return
      }
      closeForm()
      fetchAccounts(setState)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleEditSubmit(accountId: string): Promise<void> {
    if (isSaving) {
      return
    }
    setIsSaving(true)
    setFormError(undefined)
    try {
      const input: UpdateAccountRendererInput = {
        id: accountId,
        name: formName,
        subtype: formSubtype.trim().length > 0 ? formSubtype : null
      }
      const result = await window.ledgerpage.updateAccount(input)
      if (!result.success) {
        setFormError(describeAccountError(result.errorCode))
        return
      }
      closeForm()
      fetchAccounts(setState)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleToggleActive(account: SafeAccount): Promise<void> {
    if (busyAccountId !== undefined) {
      return
    }
    setBusyAccountId(account.id)
    try {
      const result = account.isActive
        ? await window.ledgerpage.deactivateAccount({ id: account.id })
        : await window.ledgerpage.reactivateAccount({ id: account.id })
      if (result.success) {
        fetchAccounts(setState)
      }
    } finally {
      setBusyAccountId(undefined)
    }
  }

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>Chart of Accounts</h1>
        {canManageAccounts && formMode.kind === 'none' && (
          <button type="button" onClick={openCreateForm} style={auditPrimaryButtonStyle}>
            New account
          </button>
        )}
      </div>

      {state.kind === 'ready' && accounts.length > 0 && formMode.kind === 'none' && (
        <div style={{ marginBottom: '0.75rem' }}>
          <label htmlFor="account-search" style={{ display: 'none' }}>
            Search accounts
          </label>
          <input
            id="account-search"
            type="text"
            placeholder="Search by code, name, or subtype…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            style={{ ...auditFieldStyle(), maxWidth: '24rem' }}
          />
        </div>
      )}

      {formMode.kind === 'creating' && (
        <div style={auditPanelStyle}>
          <h2 style={{ ...auditHeadingStyle, fontSize: '1rem' }}>New account</h2>
          <div style={auditFieldGroupStyle}>
            <label htmlFor="new-account-code" style={auditLabelStyle}>
              Code
            </label>
            <input
              id="new-account-code"
              type="text"
              value={formCode}
              onChange={(event) => setFormCode(event.target.value)}
              style={auditFieldStyle()}
            />
          </div>
          <div style={auditFieldGroupStyle}>
            <label htmlFor="new-account-name" style={auditLabelStyle}>
              Name
            </label>
            <input
              id="new-account-name"
              type="text"
              value={formName}
              onChange={(event) => setFormName(event.target.value)}
              style={auditFieldStyle()}
            />
          </div>
          <div style={auditFieldGroupStyle}>
            <label htmlFor="new-account-category" style={auditLabelStyle}>
              Category
            </label>
            <select
              id="new-account-category"
              value={formCategory}
              onChange={(event) => setFormCategory(event.target.value as AccountCategory)}
              style={auditFieldStyle()}
            >
              {ACCOUNT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
          <div style={auditFieldGroupStyle}>
            <label htmlFor="new-account-subtype" style={auditLabelStyle}>
              Subtype (optional)
            </label>
            <input
              id="new-account-subtype"
              type="text"
              value={formSubtype}
              onChange={(event) => setFormSubtype(event.target.value)}
              style={auditFieldStyle()}
            />
          </div>
          {formError && <p style={auditFieldErrorTextStyle}>{formError}</p>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => void handleCreateSubmit()}
              disabled={isSaving}
              style={auditPrimaryButtonStyle}
            >
              Create account
            </button>
            <button type="button" onClick={closeForm} style={auditGhostButtonStyle}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {formMode.kind === 'editing' && (
        <div style={auditPanelStyle}>
          <h2 style={{ ...auditHeadingStyle, fontSize: '1rem' }}>Edit account</h2>
          <div style={auditFieldGroupStyle}>
            <label htmlFor="edit-account-name" style={auditLabelStyle}>
              Name
            </label>
            <input
              id="edit-account-name"
              type="text"
              value={formName}
              onChange={(event) => setFormName(event.target.value)}
              style={auditFieldStyle()}
            />
          </div>
          <div style={auditFieldGroupStyle}>
            <label htmlFor="edit-account-subtype" style={auditLabelStyle}>
              Subtype (optional)
            </label>
            <input
              id="edit-account-subtype"
              type="text"
              value={formSubtype}
              onChange={(event) => setFormSubtype(event.target.value)}
              style={auditFieldStyle()}
            />
          </div>
          {formError && <p style={auditFieldErrorTextStyle}>{formError}</p>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => void handleEditSubmit(formMode.accountId)}
              disabled={isSaving}
              style={auditPrimaryButtonStyle}
            >
              Save changes
            </button>
            <button type="button" onClick={closeForm} style={auditGhostButtonStyle}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.kind === 'loading' && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      )}

      {state.kind === 'error' && (
        <div style={auditBannerStyle}>
          Couldn&rsquo;t load the chart of accounts. Try reloading the app.
        </div>
      )}

      {state.kind === 'ready' && accounts.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>No accounts yet.</p>
      )}

      {state.kind === 'ready' && accounts.length > 0 && filteredAccounts.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>
          No accounts match &ldquo;{searchQuery}&rdquo;.
        </p>
      )}

      {state.kind === 'ready' && filteredAccounts.length > 0 && formMode.kind === 'none' && (
        <div style={auditPanelStyle}>
          <table style={auditTableStyle}>
            <thead>
              <tr style={auditHeaderRowStyle}>
                <th style={auditHeaderCellStyle}>Code</th>
                <th style={auditHeaderCellStyle}>Name</th>
                <th style={auditHeaderCellStyle}>Category</th>
                <th style={auditHeaderCellStyle}>Normal balance</th>
                <th style={auditHeaderCellStyle}>Subtype</th>
                <th style={auditHeaderCellStyle}>Status</th>
                {canManageAccounts && <th style={auditHeaderCellStyle}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map((account, index) => (
                <tr
                  key={account.id}
                  style={{
                    borderBottom:
                      index === filteredAccounts.length - 1
                        ? 'none'
                        : `1px solid ${auditColors.border}`
                  }}
                >
                  <td style={{ ...auditBodyCellStyle, fontFamily: 'ui-monospace, monospace' }}>
                    {account.code}
                  </td>
                  <td style={auditBodyCellStyle}>{account.name}</td>
                  <td style={auditBodyCellStyle}>{account.category}</td>
                  <td style={auditBodyCellStyle}>{account.normalBalance}</td>
                  <td style={auditBodyCellStyle}>{account.subtype ?? '\u2014'}</td>
                  <td style={auditBodyCellStyle}>
                    <span style={statusBadgeStyle(account.isActive)}>
                      {account.isActive ? 'active' : 'inactive'}
                    </span>
                  </td>
                  {canManageAccounts && (
                    <td style={auditBodyCellStyle}>
                      <div style={{ display: 'flex', gap: '0.375rem' }}>
                        <button
                          type="button"
                          onClick={() => openEditForm(account)}
                          style={auditGhostButtonStyle}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleActive(account)}
                          disabled={busyAccountId === account.id}
                          style={auditGhostButtonStyle}
                        >
                          {account.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function describeAccountError(errorCode: string): string {
  switch (errorCode) {
    case 'duplicate_code':
      return 'An account with this code already exists.'
    case 'invalid_input':
      return 'Please check the values entered and try again.'
    case 'not_authorized':
      return 'You do not have permission to do this.'
    case 'not_found':
      return 'That account could not be found.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
